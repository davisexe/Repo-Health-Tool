const fs = require('fs');
const path = require('path');

const DEFAULT_IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.next', 'out',
]);

const JS_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const MD_EXT = new Set(['.md', '.mdx']);

const JS_KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof',
  'new', 'in', 'of', 'do', 'else', 'try', 'throw', 'await', 'yield',
  'super', 'class', 'const', 'let', 'var', 'delete', 'void', 'instanceof',
]);

function walk(dir, extFilter, ignoreDirs = DEFAULT_IGNORE_DIRS) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (ignoreDirs.has(entry.name)) continue;
      results.push(...walk(full, extFilter, ignoreDirs));
    } else if (extFilter.has(path.extname(entry.name))) {
      results.push(full);
    }
  }
  return results;
}
const JSDOC_RE = /\/\*\*([\s\S]*?)\*\//g;

// function foo(a, b) {           | export async function foo(a, b) {
const FUNC_DECL_RE =
  /(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s+([A-Za-z0-9_$]+)\s*\(([^)]*)\)/g;

// const foo = (a, b) => {        | export const foo = async (a, b) => {
const ARROW_DECL_RE =
  /(?:export\s+)?const\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*=>/g;

function lineOf(content, index) {
  return content.slice(0, index).split('\n').length;
}

function parseParamNames(rawParams) {
  if (!rawParams.trim()) return [];
  
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      let name = p
        .replace(/=.*/s, '') // drop default value
        .replace(/:.*/s, '') // drop TS type annotation
        .trim();
      if (name.startsWith('...')) name = name.slice(3).trim();
      // destructured param: {a, b} or [a, b] -> keep as literal marker
      if (name.startsWith('{') || name.startsWith('[')) return name;
      return name;
    })
    .filter(Boolean);
}

function extractJsDocParams(commentBody) {
  const params = [];
  const re = /@param\s+(?:\{[^}]*\}\s+)?\[?([A-Za-z0-9_$.]+)\]?/g;
  let m;
  while ((m = re.exec(commentBody))) {
    // strip destructured sub-paths like options.foo -> options
    params.push(m[1].split('.')[0]);
  }
  return params;
}

function findPrecedingJsDoc(content, declStart, jsdocBlocks) {
  // Find the JSDoc block whose end is closest before declStart, allowing
  // only whitespace/newlines (and stray "export"/"default"/"async"
  // keywords, already part of declStart) in between.
  let best = null;
  for (const block of jsdocBlocks) {
    if (block.end > declStart) continue;
    const between = content.slice(block.end, declStart);
    if (/^[\s]*$/.test(between)) {
      if (!best || block.end > best.end) best = block;
    }
  }
  return best;
}

function extractFunctions(content) {
  const jsdocBlocks = [];
  let jm;
  JSDOC_RE.lastIndex = 0;
  while ((jm = JSDOC_RE.exec(content))) {
    jsdocBlocks.push({ start: jm.index, end: jm.index + jm[0].length, body: jm[1] });
  }

  const fns = [];
  for (const re of [FUNC_DECL_RE, ARROW_DECL_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content))) {
      const [full, name, rawParams] = m;
      const doc = findPrecedingJsDoc(content, m.index, jsdocBlocks);
      fns.push({
        name,
        params: parseParamNames(rawParams),
        line: lineOf(content, m.index),
        isExported: /^export\b/.test(full) || full.includes('export '),
        doc: doc ? { params: extractJsDocParams(doc.body), line: lineOf(content, doc.start) } : null,
      });
    }
  }
  return fns;
}

// ---------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------

function analyzeFile(filePath, content, opts) {
  const issues = [];
  const fns = extractFunctions(content);

  for (const fn of fns) {
    if (fn.doc) {
      const codeParams = fn.params.map((p) => p.replace(/^\{|\}$|^\[|\]$/g, ''));
      const docParams = fn.doc.params;
      const codeSet = new Set(codeParams);
      const docSet = new Set(docParams);

      const missingFromDoc = codeParams.filter((p) => !docSet.has(p));
      const staleInDoc = docParams.filter((p) => !codeSet.has(p));

      if (missingFromDoc.length || staleInDoc.length) {
        issues.push({
          type: 'param-mismatch',
          file: filePath,
          line: fn.line,
          docLine: fn.doc.line,
          function: fn.name,
          detail: describeMismatch(fn.name, missingFromDoc, staleInDoc),
          missingFromDoc,
          staleInDoc,
        });
      }
    } else if (opts.strict && fn.isExported) {
      issues.push({
        type: 'missing-doc',
        file: filePath,
        line: fn.line,
        function: fn.name,
        detail: `Exported function "${fn.name}" has no JSDoc comment`,
      });
    }
  }

  return { fns, issues };
}

function describeMismatch(name, missingFromDoc, staleInDoc) {
  const parts = [];
  if (missingFromDoc.length) {
    parts.push(`code has param(s) not documented: ${missingFromDoc.join(', ')}`);
  }
  if (staleInDoc.length) {
    parts.push(`JSDoc mentions param(s) that no longer exist: ${staleInDoc.join(', ')}`);
  }
  return `"${name}" — ${parts.join('; ')}`;
}

// ---------------------------------------------------------------------
// Markdown cross-reference check
// ---------------------------------------------------------------------

function findMarkdownReferences(mdContent) {
  const fencedCallRe = /```(?:js|jsx|ts|tsx|javascript|typescript)\n([\s\S]*?)```/g;
  const inlineCodeRe = /`([A-Za-z0-9_$]+)\(?\)?`/g;

  const calledInFences = new Set();
  let m;
  while ((m = fencedCallRe.exec(mdContent))) {
    const code = m[1];
    const callRe = /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
    let cm;
    while ((cm = callRe.exec(code))) {
      const name = cm[1];
      if (!JS_KEYWORDS.has(name)) calledInFences.add(name);
    }
  }

  const inlineMentioned = new Set();
  while ((m = inlineCodeRe.exec(mdContent))) {
    inlineMentioned.add(m[1]);
  }

  // Only treat it as an "API reference" if it's both demoed in a fenced
  // block AND explicitly called out elsewhere as inline code — that's the
  // pattern real docs use ("call `doThing()`... example: ```doThing(1)```")
  // and it keeps false positives from arbitrary example code low.
  const referenced = [...calledInFences].filter((name) => inlineMentioned.has(name));
  return referenced;
}

function analyzeMarkdown(filePath, content, knownFunctionNames) {
  const issues = [];
  const referenced = findMarkdownReferences(content);
  for (const name of referenced) {
    if (!knownFunctionNames.has(name)) {
      issues.push({
        type: 'stale-md-reference',
        file: filePath,
        line: null,
        function: name,
        detail: `"${name}" is demoed in a code sample but no longer exists anywhere in the source`,
      });
    }
  }
  return issues;
}

// ---------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------

function run(rootDir, opts = {}) {
  const options = { strict: false, ...opts };
  const jsFiles = walk(rootDir, JS_EXT);
  const mdFiles = walk(rootDir, MD_EXT);

  const allIssues = [];
  const knownFunctionNames = new Set();
  const fileResults = [];

  for (const file of jsFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const rel = path.relative(rootDir, file);
    const { fns, issues } = analyzeFile(rel, content, options);
    fns.forEach((f) => knownFunctionNames.add(f.name));
    fileResults.push({ file: rel, fns });
    allIssues.push(...issues);
  }

  for (const file of mdFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const rel = path.relative(rootDir, file);
    allIssues.push(...analyzeMarkdown(rel, content, knownFunctionNames));
  }

  return {
    issues: allIssues,
    stats: {
      filesScanned: jsFiles.length + mdFiles.length,
      functionsScanned: fileResults.reduce((n, f) => n + f.fns.length, 0),
      issueCount: allIssues.length,
    },
  };
}

module.exports = { run, extractFunctions, analyzeFile, analyzeMarkdown, walk };
