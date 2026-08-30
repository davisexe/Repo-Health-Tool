#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');
const { run } = require('./health-engine');
const { renderHtml } = require('./render-html');

function parseArgs(argv) {
  const args = {
    dir: '.', json: false, html: null, format: 'text', out: null,
    abandonedMonths: 18, failOn: 'vulnerable',
  };
  for (const arg of argv) {
    if (arg.startsWith('--dir=')) args.dir = arg.slice('--dir='.length);
    else if (arg === '--json') args.json = true;
    else if (arg.startsWith('--html=')) args.html = arg.slice('--html='.length);
    else if (arg.startsWith('--out=')) args.out = arg.slice('--out='.length);
    else if (arg.startsWith('--format=')) args.format = arg.slice('--format='.length);
    else if (arg.startsWith('--abandoned-months=')) args.abandonedMonths = Number(arg.split('=')[1]);
    else if (arg.startsWith('--fail-on=')) args.failOn = arg.slice('--fail-on='.length); // none|outdated|abandoned|deprecated|vulnerable
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

function printHelp() {
  console.log(`
dependency-health-dashboard — outdated / vulnerable / abandoned packages at a glance

Usage:
  node check-deps.js [--dir=.] [--html=report.html] [--json] [--format=github]
                      [--fail-on=vulnerable] [--abandoned-months=18]

Options:
  --dir=<path>            Directory containing package.json (default: .)
  --html=<file>           Write a standalone HTML dashboard to this file
  --json                  Print machine-readable JSON to stdout
  --out=<file>            Also write the stdout report (text/json, matching --json) to a file
  --format=github         Print a Markdown summary (for GitHub step summaries)
  --fail-on=<level>       Exit non-zero if any package is at or above this severity:
                          none | outdated | abandoned | deprecated | vulnerable (default)
  --abandoned-months=<n>  Months since last publish before a package is "abandoned" (default: 18)
`);
}

const SEVERITY_ORDER = ['ok', 'outdated', 'abandoned', 'deprecated', 'vulnerable'];

function shouldFail(summary, failOn) {
  if (failOn === 'none') return false;
  const threshold = SEVERITY_ORDER.indexOf(failOn);
  if (threshold === -1) return false;
  return SEVERITY_ORDER.slice(threshold).some((level) => summary[level] > 0);
}

const COLORS = {
  reset: '\x1b[0m', red: '\x1b[31m', yellow: '\x1b[33m', magenta: '\x1b[35m',
  cyan: '\x1b[36m', dim: '\x1b[2m', bold: '\x1b[1m', green: '\x1b[32m',
};
const STATUS_COLOR = {
  ok: COLORS.green, outdated: COLORS.yellow, abandoned: COLORS.cyan,
  deprecated: COLORS.magenta, vulnerable: COLORS.red,
};
const STATUS_ICON = {
  ok: '✔', outdated: '↑', abandoned: '⏳', deprecated: '⚠', vulnerable: '✖',
};

function textReport(result) {
  const lines = [];
  lines.push(`${COLORS.bold}${result.project}${COLORS.reset} — dependency health`, '');
  for (const p of result.packages) {
    const c = STATUS_COLOR[p.status];
    const icon = STATUS_ICON[p.status];
    let extra = '';
    if (p.status === 'outdated') extra = `${p.currentVersion} → ${p.latestVersion}`;
    else if (p.status === 'abandoned') extra = `last published ${p.monthsSincePublish}mo ago`;
    else if (p.status === 'deprecated') extra = p.deprecationMessage || 'marked deprecated';
    else if (p.status === 'vulnerable') extra = p.vulnerabilities.map((v) => v.id).join(', ');
    lines.push(`  ${c}${icon} ${p.status.padEnd(10)}${COLORS.reset} ${p.name.padEnd(28)} ${COLORS.dim}${extra}${COLORS.reset}`);
  }
  lines.push('', `${COLORS.dim}${Object.entries(result.summary).map(([k, v]) => `${k}: ${v}`).join('  ·  ')}${COLORS.reset}`);
  if (result.errors.length) {
    lines.push('', `${COLORS.yellow}${result.errors.length} lookup error(s):${COLORS.reset}`);
    for (const e of result.errors) lines.push(`  ${e.name} (${e.stage}): ${e.message}`);
  }
  return lines.join('\n');
}

function githubMarkdownReport(result) {
  const lines = [`## 📦 Dependency health — ${result.project}`, ''];
  lines.push(
    Object.entries(result.summary).map(([k, v]) => `**${v}** ${k}`).join(' · '),
    ''
  );
  const flagged = result.packages.filter((p) => p.status !== 'ok');
  if (!flagged.length) {
    lines.push('✅ Everything looks healthy.');
    return lines.join('\n');
  }
  lines.push('| Package | Status | Detail |', '|---|---|---|');
  for (const p of flagged) {
    let detail = '';
    if (p.status === 'outdated') detail = `${p.currentVersion} → ${p.latestVersion}`;
    else if (p.status === 'abandoned') detail = `last published ${p.monthsSincePublish}mo ago`;
    else if (p.status === 'deprecated') detail = p.deprecationMessage || 'marked deprecated';
    else if (p.status === 'vulnerable') detail = p.vulnerabilities.map((v) => v.id).join(', ');
    lines.push(`| \`${p.name}\` | ${STATUS_ICON[p.status]} ${p.status} | ${detail.replace(/\|/g, '\\|')} |`);
  }
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();

  const rootDir = path.resolve(process.cwd(), args.dir);

  let result;
  try {
    result = await run(rootDir, { abandonedMonths: args.abandonedMonths });
  } catch (err) {
    console.error(`Failed: ${err.message}`);
    process.exit(2);
  }

  let output;
  if (args.json) output = JSON.stringify(result, null, 2);
  else if (args.format === 'github') output = githubMarkdownReport(result);
  else output = textReport(result);

  console.log(output);

  if (args.html) {
    fs.writeFileSync(args.html, renderHtml(result));
    console.log(`\nHTML dashboard written to ${args.html}`);
  }

  if (args.out) {
    fs.writeFileSync(args.out, output.replace(/\x1b\[[0-9;]*m/g, ''));
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, githubMarkdownReport(result) + '\n');
  }

  process.exit(shouldFail(result.summary, args.failOn) ? 1 : 0);
}

main();
