'use strict';

const STATUS_META = {
  vulnerable: { label: 'Vulnerable', color: '#c1352d', bg: '#fbeceb' },
  deprecated: { label: 'Deprecated', color: '#9b3fc2', bg: '#f6ecfb' },
  abandoned: { label: 'Abandoned', color: '#b8790a', bg: '#fbf1e1' },
  outdated: { label: 'Outdated', color: '#8a6d00', bg: '#faf6e2' },
  ok: { label: 'Healthy', color: '#227a4d', bg: '#e9f7ef' },
};

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function renderHtml(result) {
  const dataJson = JSON.stringify(result).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Dependency health — ${esc(result.project)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@600;700&family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #f6f5f2;
    --panel: #ffffff;
    --border: #e4e1da;
    --text: #232220;
    --text-dim: #6b675f;
    --accent: #2b5d4e;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font-family: 'Inter', system-ui, sans-serif; }
  .wrap { max-width: 980px; margin: 0 auto; padding: 48px 24px 80px; }
  h1 { font-family: 'Source Serif 4', serif; font-size: 30px; font-weight: 700; margin: 0 0 4px; letter-spacing: -0.01em; }
  .meta { color: var(--text-dim); font-size: 13px; font-family: 'IBM Plex Mono', monospace; margin-bottom: 32px; }

  .summary { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-bottom: 32px; }
  .stat { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 14px 12px; cursor: pointer; transition: transform .1s ease; }
  .stat:hover { transform: translateY(-1px); }
  .stat.active { box-shadow: 0 0 0 2px var(--accent) inset; }
  .stat .count { font-family: 'Source Serif 4', serif; font-size: 26px; font-weight: 700; }
  .stat .label { font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-dim); margin-top: 2px; }

  .toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .toolbar input { font-family: inherit; font-size: 13px; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border); width: 220px; background: var(--panel); }
  .clear-filter { font-size: 12px; color: var(--accent); background: none; border: none; cursor: pointer; text-decoration: underline; visibility: hidden; }
  .clear-filter.show { visibility: visible; }

  table { width: 100%; border-collapse: collapse; background: var(--panel); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
  thead th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-dim); padding: 12px 16px; border-bottom: 1px solid var(--border); }
  tbody td { padding: 12px 16px; border-bottom: 1px solid var(--border); font-size: 13.5px; vertical-align: top; }
  tbody tr:last-child td { border-bottom: none; }
  .pkg-name { font-family: 'IBM Plex Mono', monospace; font-weight: 600; }
  .badge { display: inline-block; font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 999px; }
  .detail { color: var(--text-dim); font-size: 12.5px; font-family: 'IBM Plex Mono', monospace; }
  .vuln-id { display: block; }

  .empty-state { text-align: center; color: var(--text-dim); padding: 40px; font-size: 13px; }
  footer { margin-top: 24px; color: var(--text-dim); font-size: 11.5px; text-align: center; }
</style>
</head>
<body>
  <div class="wrap">
    <h1>Dependency health</h1>
    <div class="meta">${esc(result.project)} · generated ${esc(new Date(result.generatedAt).toLocaleString())}</div>

    <div class="summary" id="summary"></div>

    <div class="toolbar">
      <input type="text" id="search" placeholder="Filter by package name…" />
      <button class="clear-filter" id="clearFilter">Clear status filter</button>
    </div>

    <table>
      <thead>
        <tr><th>Package</th><th>Status</th><th>Detail</th></tr>
      </thead>
      <tbody id="rows"></tbody>
    </table>
    <div class="empty-state" id="emptyState" hidden>No packages match this filter.</div>

    <footer>Vulnerability data via OSV.dev · registry data via registry.npmjs.org</footer>
  </div>

<script>
  const DATA = ${dataJson};
  const STATUS_META = ${JSON.stringify(STATUS_META)};
  const STATUS_ORDER = ['vulnerable', 'deprecated', 'abandoned', 'outdated', 'ok'];

  let statusFilter = null;
  let searchTerm = '';

  function detailFor(p) {
    if (p.status === 'outdated') return \`\${p.currentVersion || '?'} → \${p.latestVersion || '?'}\`;
    if (p.status === 'abandoned') return \`last published \${p.monthsSincePublish}mo ago\`;
    if (p.status === 'deprecated') return p.deprecationMessage || 'marked deprecated on npm';
    if (p.status === 'vulnerable') return p.vulnerabilities.map(v => v.id).join(', ');
    return \`up to date (\${p.currentVersion || p.latestVersion || ''})\`;
  }

  function renderSummary() {
    const el = document.getElementById('summary');
    el.innerHTML = STATUS_ORDER.map(status => {
      const meta = STATUS_META[status];
      const count = DATA.summary[status] || 0;
      const active = statusFilter === status ? ' active' : '';
      return \`<div class="stat\${active}" data-status="\${status}" style="background:\${meta.bg}">
        <div class="count" style="color:\${meta.color}">\${count}</div>
        <div class="label">\${meta.label}</div>
      </div>\`;
    }).join('');
    el.querySelectorAll('.stat').forEach(node => {
      node.addEventListener('click', () => {
        const s = node.dataset.status;
        statusFilter = statusFilter === s ? null : s;
        render();
      });
    });
  }

  function renderRows() {
    const tbody = document.getElementById('rows');
    const empty = document.getElementById('emptyState');
    let pkgs = DATA.packages;
    if (statusFilter) pkgs = pkgs.filter(p => p.status === statusFilter);
    if (searchTerm) pkgs = pkgs.filter(p => p.name.toLowerCase().includes(searchTerm));

    if (!pkgs.length) {
      tbody.innerHTML = '';
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    tbody.innerHTML = pkgs.map(p => {
      const meta = STATUS_META[p.status];
      return \`<tr>
        <td class="pkg-name">\${p.name}</td>
        <td><span class="badge" style="background:\${meta.bg};color:\${meta.color}">\${meta.label}</span></td>
        <td class="detail">\${detailFor(p)}</td>
      </tr>\`;
    }).join('');
  }

  function render() {
    renderSummary();
    renderRows();
    document.getElementById('clearFilter').classList.toggle('show', !!statusFilter);
  }

  document.getElementById('search').addEventListener('input', (e) => {
    searchTerm = e.target.value.trim().toLowerCase();
    renderRows();
  });
  document.getElementById('clearFilter').addEventListener('click', () => {
    statusFilter = null;
    render();
  });

  render();
</script>
</body>
</html>`;
}

module.exports = { renderHtml };
