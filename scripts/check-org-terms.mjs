#!/usr/bin/env node
/**
 * Guard: an overridable PMO term is never hard-coded in UI source (#2529).
 *
 * An org Admin renames work order / project / client-supplied stock / purchase request / discipline / material request.
 * The rename reaches a screen only through i18n (`t()`), whose terminology adapter rewrites the
 * shipped wording. A word typed straight into JSX text, a user-facing attribute or a label-like
 * property bypasses that and keeps the old name for every org.
 *
 * Scope: non-test `.ts`/`.tsx` under pmo-portal/pages and pmo-portal/src. Flags (1) JSX text,
 * (2) string JSX attributes named title/label/placeholder/aria-label/alt/description/sub/heading,
 * (3) string values of object properties named label/title/description/message/placeholder/heading.
 * A `t('key', 'Default')` argument is NOT flagged: defaults are localized through the catalogue.
 *
 * Existing offenders are a RATCHET (scripts/org-terms-baseline.json: file → count). A file may not
 * gain a hit; a baseline entry whose file now has fewer hits fails as stale, so the list only shrinks.
 *
 * Run: node scripts/check-org-terms.mjs [--update-baseline] | --self-test
 * Known limit: it reads English wording only; Bahasa wording lives in catalogues, which the
 * terminology adapter already covers.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';
import { createRequire } from 'node:module';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(REPO, 'pmo-portal/package.json'));
const ts = require('typescript');
const BASELINE = resolve(REPO, 'scripts/org-terms-baseline.json');

/** The shipped English wording of each overridable term (mirror of SHIPPED_FORMS.en). */
export const TERM_PATTERNS = {
  workOrder: /\bwork orders?\b/i,
  project: /\bprojects?\b/i,
  clientSuppliedStock: /\bclient-supplied stock\b/i,
  purchaseRequest: /\bpurchase requests?\b/i,
  discipline: /\bdisciplines?\b/i,
  materialRequest: /\bmaterial requests?\b/i,
  deliveryNote: /\bdelivery notes?\b/i,
};
const ATTRS = new Set(['title', 'label', 'placeholder', 'aria-label', 'alt', 'description', 'sub', 'heading', 'aria-description', 'aria-valuetext', 'helperText', 'emptyTitle', 'emptyMessage', 'ariaLabel', 'ariaDescription', 'tooltip', 'caption', 'subtitle']);
const PROPS = new Set(['label', 'title', 'description', 'message', 'placeholder', 'heading', 'ariaLabel', 'ariaDescription', 'emptyTitle', 'emptyMessage', 'helperText', 'tooltip', 'caption', 'subtitle']);

export function findTerm(text) {
  for (const [key, re] of Object.entries(TERM_PATTERNS)) if (re.test(text)) return key;
  return null;
}

/** Hits in one source text: [{line, term, text}]. */
export function scanSource(source, fileName = 'x.tsx') {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hits = [];
  const add = (node, text) => {
    const term = findTerm(text);
    if (!term) return;
    hits.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, term, text: text.trim().slice(0, 60) });
  };
  const addExpression = (node) => {
    if (ts.isStringLiteralLike(node)) add(node, node.text);
    else if (ts.isParenthesizedExpression(node)) addExpression(node.expression);
    else if (ts.isConditionalExpression(node)) { addExpression(node.whenTrue); addExpression(node.whenFalse); }
    else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) { addExpression(node.left); addExpression(node.right); }
    else if (ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) addExpression(node.right);
    else if (ts.isTemplateExpression(node)) {
      add(node.head, node.head.text);
      for (const span of node.templateSpans) add(span.literal, span.literal.text);
    }
  };
  const visit = (node) => {
    if (ts.isJsxText(node)) add(node, node.text);
    else if (ts.isJsxExpression(node) && node.expression && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) addExpression(node.expression);
    else if (ts.isJsxAttribute(node) && node.initializer && ATTRS.has(node.name.getText(sf))) {
      if (ts.isJsxExpression(node.initializer) && node.initializer.expression) addExpression(node.initializer.expression);
      else addExpression(node.initializer);
    }
    else if (ts.isPropertyAssignment(node) && PROPS.has(node.name.getText(sf).replace(/['"]/g, ''))) addExpression(node.initializer);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules' || name === '__tests__') continue;
      yield* walk(p);
    } else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !name.endsWith('.d.ts')) yield p;
  }
}

export function scanRepo() {
  const counts = {};
  for (const root of ['pmo-portal/pages', 'pmo-portal/src']) {
    for (const file of walk(resolve(REPO, root))) {
      const n = scanSource(readFileSync(file, 'utf8'), file).length;
      if (n) counts[relative(REPO, file)] = n;
    }
  }
  return counts;
}

/** Compare current counts with the baseline; returns failure lines. */
export function compare(current, baseline) {
  const fails = [];
  for (const [f, n] of Object.entries(current)) {
    const allowed = baseline[f] ?? 0;
    if (n > allowed) fails.push(`${f}: ${n} hard-coded term(s), baseline ${allowed} — route the wording through t()`);
  }
  for (const [f, n] of Object.entries(baseline)) {
    if ((current[f] ?? 0) < n) fails.push(`${f}: baseline ${n} is stale (now ${current[f] ?? 0}) — run --update-baseline`);
  }
  return fails;
}

function selfTest() {
  const bad = `export const A = () => <div title="Open projects"><p>New work order</p></div>;
const col = { label: 'Purchase request', key: 'x' };
const extra = { ariaLabel: 'Project', emptyTitle: 'Work orders' };`;
  const expressionHits = scanSource(`const A = ({ok}) => <><span>{'Project'}</span><p>{ok ? 'Work order' : ''}</p><div aria-description={\`Projects: ${'${count}'}\`} /><b>{'Project ' + name}</b></>;`);
  if (expressionHits.length !== 4) throw new Error(`JSX expressions not caught: ${expressionHits.length}`);
  const hits = scanSource(bad);
  const terms = hits.map((h) => h.term).sort().join(',');
  if (terms !== 'project,project,purchaseRequest,workOrder,workOrder') throw new Error(`planted cases: got ${terms}`);
  const ok = `export const A = () => <p>{t('a.b', 'Work order')}</p>;\nconst x = { key: 'work order' };`;
  if (scanSource(ok).length) throw new Error('t() default or non-label property was flagged');
  if (compare({ a: 2 }, { a: 1 }).length !== 1) throw new Error('growth not caught');
  if (compare({ a: 1 }, { a: 2 }).length !== 1) throw new Error('stale baseline not caught');
  console.log('check-org-terms self-test: ok');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--self-test')) selfTest();
  else {
    const current = scanRepo();
    if (process.argv.includes('--update-baseline')) {
      writeFileSync(BASELINE, JSON.stringify(Object.fromEntries(Object.entries(current).sort()), null, 2) + '\n');
      console.log(`baseline written: ${Object.keys(current).length} file(s)`);
    } else {
      const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
      const fails = compare(current, baseline);
      if (fails.length) {
        console.error(fails.join('\n'));
        process.exit(1);
      }
      console.log(`check-org-terms: ok (${Object.keys(current).length} file(s) at baseline)`);
    }
  }
}
