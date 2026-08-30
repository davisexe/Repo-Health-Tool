const fs = require('fs');
const path = require('path');

const NPM_REGISTRY = 'https://registry.npmjs.org';
const OSV_API = 'https://api.osv.dev/v1/querybatch';

const ABANDONED_MONTHS_DEFAULT = 18;

function readPackageJson(dir) {
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    throw new Error(`No package.json found at ${pkgPath}`);
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  return { pkg, deps };
}

function readLockedVersions(dir) {
  const lockPath = path.join(dir, 'package-lock.json');
  const versions = {};
  if (!fs.existsSync(lockPath)) return versions;
  try {
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    const packages = lock.packages || {};
    for (const [key, info] of Object.entries(packages)) {
      if (!key.startsWith('node_modules/')) continue;
      const name = key.slice('node_modules/'.length);
      if (name.includes('node_modules/')) continue; // skip nested
      if (info.version) versions[name] = info.version;
    }
  } catch {
  }
  return versions;
}

function monthsSince(dateStr) {
  if (!dateStr) return null;
  const then = new Date(dateStr).getTime();
  if (Number.isNaN(then)) return null;
  return (Date.now() - then) / (1000 * 60 * 60 * 24 * 30.44);
}

async function fetchRegistryInfo(name) {
  const url = `${NPM_REGISTRY}/${encodeURIComponent(name).replace('%40', '@')}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`registry lookup failed (${res.status})`);
  const data = await res.json();
  const latest = data['dist-tags']?.latest;
  const latestInfo = data.versions?.[latest] || {};
  return {
    latest,
    lastPublish: data.time?.[latest] || data.time?.modified || null,
    deprecated: Boolean(latestInfo.deprecated),
    deprecationMessage: typeof latestInfo.deprecated === 'string' ? latestInfo.deprecated : null,
    repository: latestInfo.repository?.url || null,
  };
}

async function fetchVulnerabilities(packages) {
  // packages: [{ name, version }]
  const queries = packages.map((p) => ({
    package: { name: p.name, ecosystem: 'npm' },
    version: p.version,
  }));
  const res = await fetch(OSV_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queries }),
  });
  if (!res.ok) throw new Error(`OSV lookup failed (${res.status})`);
  const data = await res.json();
  const results = data.results || [];
  return packages.map((p, i) => ({
    name: p.name,
    vulns: (results[i]?.vulns || []).map((v) => ({
      id: v.id,
      summary: v.summary || v.details?.slice(0, 140) || 'No summary available',
    })),
  }));
}

function stripSemverRange(range) {
  return String(range).replace(/^[\^~>=<\s]+/, '').split(/[\s|]/)[0] || null;
}

function scorePackage({ name, declaredRange, installedVersion, registryInfo, vulns, abandonedMonths }) {
  const currentVersion = installedVersion || stripSemverRange(declaredRange);
  const monthsOld = monthsSince(registryInfo?.lastPublish);
  const isOutdated = registryInfo?.latest && currentVersion && registryInfo.latest !== currentVersion;
  const isAbandoned = monthsOld !== null && monthsOld >= abandonedMonths;
  const isDeprecated = Boolean(registryInfo?.deprecated);
  const hasVulns = vulns && vulns.length > 0;

  let status = 'ok';
  if (hasVulns) status = 'vulnerable';
  else if (isDeprecated) status = 'deprecated';
  else if (isAbandoned) status = 'abandoned';
  else if (isOutdated) status = 'outdated';

  return {
    name,
    declaredRange,
    currentVersion,
    latestVersion: registryInfo?.latest || null,
    lastPublish: registryInfo?.lastPublish || null,
    monthsSincePublish: monthsOld !== null ? Math.round(monthsOld) : null,
    deprecated: isDeprecated,
    deprecationMessage: registryInfo?.deprecationMessage || null,
    vulnerabilities: vulns || [],
    status,
  };
}

const STATUS_PRIORITY = { vulnerable: 0, deprecated: 1, abandoned: 2, outdated: 3, ok: 4 };

async function run(dir, opts = {}) {
  const options = { abandonedMonths: ABANDONED_MONTHS_DEFAULT, concurrency: 8, ...opts };
  const { pkg, deps } = readPackageJson(dir);
  const locked = readLockedVersions(dir);
  const names = Object.keys(deps);

  // fetch registry info with bounded concurrency
  const registryInfoByName = {};
  const errors = [];
  let idx = 0;
  async function worker() {
    while (idx < names.length) {
      const name = names[idx++];
      try {
        registryInfoByName[name] = await fetchRegistryInfo(name);
      } catch (err) {
        errors.push({ name, stage: 'registry', message: err.message });
        registryInfoByName[name] = null;
      }
    }
  }
  await Promise.all(Array.from({ length: options.concurrency }, worker));

  let vulnByName = {};
  try {
    const results = await fetchVulnerabilities(
      names.map((name) => ({
        name,
        version: locked[name] || stripSemverRange(deps[name]),
      }))
    );
    vulnByName = Object.fromEntries(results.map((r) => [r.name, r.vulns]));
  } catch (err) {
    errors.push({ name: '(batch)', stage: 'osv', message: err.message });
  }

  const packages = names.map((name) =>
    scorePackage({
      name,
      declaredRange: deps[name],
      installedVersion: locked[name] || null,
      registryInfo: registryInfoByName[name],
      vulns: vulnByName[name] || [],
      abandonedMonths: options.abandonedMonths,
    })
  );

  packages.sort((a, b) => STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status] || a.name.localeCompare(b.name));

  const summary = { ok: 0, outdated: 0, abandoned: 0, deprecated: 0, vulnerable: 0 };
  for (const p of packages) summary[p.status]++;

  return {
    project: pkg.name || path.basename(path.resolve(dir)),
    generatedAt: new Date().toISOString(),
    packages,
    summary,
    errors,
  };
}

module.exports = { run, scorePackage, monthsSince, readPackageJson };
