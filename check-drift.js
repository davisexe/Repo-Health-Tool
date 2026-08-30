#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');
const { run } = require('./drift-engine');

function parseArgs(argv) {
  const args = { dir: '.', json: false, strict: false, out: null, format: 'text' };
  for (const arg of argv) {
    if (arg.startsWith('--dir=')) args.dir = arg.slice('--dir='.length);
    else if (arg === '--json') args.json = true;
    else if (arg === '--strict') args.strict = true;
    else if (arg.startsWith('--out=')) args.out = arg.slice('--out='.length);
    else if (arg.startsWith('--format=')) args.format = arg.slice('--format='.length);
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

function printHelp() {
  console.log(`
docs-drift-checker — find comments/docs that no longer match the code

Usage:
  node check-drift.js [--dir=.] [--strict] [--json] [--format=text|github] [--out=file]

Options:
  --dir=<path>      Directory to scan (default: current directory)
  --strict          Also flag exported functions with no JSDoc at all
  --json            Print machine-readable JSON instead of a text report
  --format=github   Print a Markdown report (used for GitHub step summaries)
  --out=<file>      Write the report (text/markdown/json, matching --format) to a file
  -h, --help        Show this help
`);
}

const COLORS = {
  reset: '\x1b[0m', red: '\x1b[31m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', dim: '\x1b[2m', bold: '\x1b[1m', green: '\x1b[32m',
};

function textReport(result) {
  const lines = [];
  const { issues, stats } = result;

  if (!issues.length) {
    lines.push(`${COLORS.green}✔ No doc drift found${COLORS.reset} (${stats.functionsScanned} functions, ${stats.filesScanned} files scanned)`);
    return lines.join('\n');
  }

  const byFile = {};
  for (const issue of issues) (byFile[issue.file] = byFile[issue.file] || []).push(issue);

  for (const [file, fileIssues] of Object.entries(byFile)) {
    lines.push(`${COLORS.bold}${file}${COLORS.reset}`);
    for (const issue of fileIssues) {
      const badge =
        issue.type === 'param-mismatch' ? `${COLORS.yellow}[param-mismatch]${COLORS.reset}` :
        issue.type === 'missing-doc' ? `${COLORS.cyan}[missing-doc]${COLORS.reset}` :
        `${COLORS.red}[stale-md-reference]${COLORS.reset}`;
      const loc = issue.line ? `:${issue.line}` : '';
      lines.push(`  ${badge} ${file}${loc} — ${issue.detail}`);
    }
    lines.push('');
  }

  lines.push(`${COLORS.dim}${issues.length} issue(s) across ${stats.filesScanned} files scanned (${stats.functionsScanned} functions).${COLORS.reset}`);
  return lines.join('\n');
}

function githubMarkdownReport(result) {
  const { issues, stats } = result;
  const lines = ['## 📝 Docs drift report', ''];

  if (!issues.length) {
    lines.push(`✅ No drift found — ${stats.functionsScanned} functions across ${stats.filesScanned} files scanned.`);
    return lines.join('\n');
  }

  lines.push(`Found **${issues.length}** issue(s) across ${stats.filesScanned} files scanned.`, '');
  lines.push('| Type | Location | Detail |', '|---|---|---|');
  for (const issue of issues) {
    const loc = issue.line ? `\`${issue.file}:${issue.line}\`` : `\`${issue.file}\``;
    lines.push(`| ${issue.type} | ${loc} | ${issue.detail.replace(/\|/g, '\\|')} |`);
  }
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();

  const rootDir = path.resolve(process.cwd(), args.dir);
  if (!fs.existsSync(rootDir)) {
    console.error(`Directory not found: ${rootDir}`);
    process.exit(2);
  }

  const result = run(rootDir, { strict: args.strict });

  let output;
  if (args.json) output = JSON.stringify(result, null, 2);
  else if (args.format === 'github') output = githubMarkdownReport(result);
  else output = textReport(result);

  console.log(output);

  if (args.out) {
    fs.writeFileSync(args.out, output.replace(/\x1b\[[0-9;]*m/g, ''));
  }

  // Always write to GITHUB_STEP_SUMMARY as Markdown when running inside
  // GitHub Actions, regardless of what --format/--json was requested for
  // stdout/--out (the step summary only ever renders Markdown).
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, githubMarkdownReport(result) + '\n');
  }

  process.exit(result.issues.length > 0 ? 1 : 0);
}

main();
