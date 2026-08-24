#!/usr/bin/env node
/**
 * FR-L10N-042a / FR-L10N-042b — the i18n completeness gate (en side + id side).
 *
 * Two en-side failures, both of which make a catalogue quietly lie about its own coverage:
 *
 *   1. UNEXTRACTED — a launch-scope screen renders an English string that never became a key.
 *      The runtime is forgiving by design (FR-L10N-041: a missing key falls back to the English
 *      source, never a raw key), so an unextracted string is INVISIBLE at runtime in every
 *      locale. It looks like working software right up to the moment a client reads it.
 *   2. ORPHANED — a catalogue key nothing references any more. It survives a refactor, gets
 *      translated, gets counted as coverage, and points at text that no longer exists.
 *
 *   FR-L10N-042's own text is why both halves are here: the forgiving runtime is affordable
 *   ONLY because this gate makes gaps unshippable. The two rulings work as a pair or not at all.
 *
 * TWO MODES, one per DD-I18N-9 stage (both wired into `check:i18n`):
 *
 *   default (en) — FR-L10N-042a, stage 1: the two failures above, over the `en` catalogue only.
 *   --id         — FR-L10N-042b, stage 2 (shipped WITH the change that populated `id`, so it was
 *                  green on arrival — DD-I18N-9, 2026-08-24): every en key a launch-scope screen
 *                  references must exist in `id` with a NON-EMPTY value, and `id` may hold no key
 *                  `en` does not (the id tree mirrors en's). Empty is a failure because i18next
 *                  falls back silently: an empty/missing id value renders as English and looks
 *                  like working software right up to the moment a client reads it.
 *
 *   The default mode still never reads `id` — en completeness must not depend on translation
 *   state, and the self-test asserts that separation structurally.
 *
 * Scope comes from `pmo-portal/src/lib/i18n/launch-scope-routes.txt`, per OD-I18N-1 (the gate
 * covers launch-scope routes, not the whole app) and DD-I18N-9 (the list is a readable file that
 * each feature adds to as it ships). Read that file's header before changing anything here.
 * En keys OUTSIDE launch scope may stay untranslated in `id` — they fall back to English until
 * their feature's line lands in the route list, matching the gate's additive staging.
 *
 * Usage:
 *   node scripts/check-i18n-completeness.mjs
 *   node scripts/check-i18n-completeness.mjs --id
 *   node scripts/check-i18n-completeness.mjs --self-test
 *
 * ⚑ Every gate in this repo is itself gated (`--self-test`), because BOTH of the existing
 *   enforcement scripts once failed for their own bugs — and a check that silently matches
 *   nothing is indistinguishable from a check that passes. The self-test plants each defect
 *   class and requires the analyser to go red, then requires a clean fixture to go green.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const APP = path.join(REPO, 'pmo-portal');
const ROUTE_LIST = path.join(APP, 'src/lib/i18n/launch-scope-routes.txt');
const EN_CATALOGUE = path.join(APP, 'public/locales/en/common.json');
/** Read ONLY by --id mode (FR-L10N-042b); the en-side loader must never touch it. */
const ID_CATALOGUE = path.join(APP, 'public/locales/id/common.json');
/** Roots scanned for key REFERENCES (the orphan half). Deliberately the whole app, not just
 *  launch scope: a key pointing at text that no longer exists is dead wherever it lives. */
const REFERENCE_ROOTS = ['pages', 'src', 'App.tsx'];

// ── Source scanning ─────────────────────────────────────────────────────────────────────────

/**
 * Blank out comments, string bodies, template bodies and regex literals, preserving every byte
 * offset and every newline so line numbers still line up with the original.
 *
 * This is what stops a doc comment from counting as a key reference — `src/lib/i18n/index.ts`
 * documents the convention with `t('budget.remaining', …)` in prose, and without this the gate
 * reports that illustration as a real reference to a key that does not exist.
 */
export function blankComments(src) {
  const out = src.split('');
  const n = src.length;
  let i = 0;
  let prevSig = '';
  const blank = (a, b) => {
    for (let k = a; k < b && k < n; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      let j = i;
      while (j < n && src[j] !== '\n') j++;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '/' && d === '*') {
      let j = src.indexOf('*/', i + 2);
      j = j < 0 ? n : j + 2;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src[j] === c) {
          j++;
          break;
        }
        if (src[j] === '\n') break;
        j++;
      }
      i = j;
      prevSig = c;
      continue;
    }
    if (c === '`') {
      let j = i + 1;
      let depth = 0;
      while (j < n) {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src[j] === '$' && src[j + 1] === '{') {
          depth++;
          j += 2;
          continue;
        }
        if (src[j] === '}' && depth > 0) {
          depth--;
          j++;
          continue;
        }
        if (src[j] === '`' && depth === 0) {
          j++;
          break;
        }
        j++;
      }
      i = j;
      prevSig = c;
      continue;
    }
    // A `/` here is a regex literal only after an operator/opener; after a value it is division.
    if (c === '/' && /[(,=:[!&|?{};+\-*%~^<>]/.test(prevSig)) {
      let j = i + 1;
      let inClass = false;
      while (j < n) {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) {
          j++;
          break;
        } else if (src[j] === '\n') break;
        j++;
      }
      i = j;
      continue;
    }
    if (!/\s/.test(c)) prevSig = c;
    i++;
  }
  return out.join('');
}

/**
 * Every `t('some.key' …)` key a source file references.
 *
 * ⚑ Static literals only, which is sufficient because the call sites were written that way on
 * purpose: `i18next-parser` extracts literal keys only, so a computed `t(\`task.status.${s}\`)`
 * would be invisible to the extractor AND to this gate, and its catalogue entries would read as
 * orphans. `MyTasks.tsx` and `Rail.tsx` both carry a comment saying exactly that. If a computed
 * key ever appears, this gate reports its keys as orphans — which is the correct alarm, not a
 * bug to be worked around by loosening the scan.
 */
export function collectKeyRefs(src) {
  const keys = new Set();
  const stripped = blankComments(src);
  // The key literal is blanked out by `blankComments`, so match the key on the ORIGINAL source
  // at offsets the stripped source proves are live code.
  const re = /(?<![A-Za-z0-9_$.])t\(\s*(['"])/g;
  let m;
  while ((m = re.exec(stripped))) {
    const quote = m[1];
    const start = m.index + m[0].length;
    const end = src.indexOf(quote, start);
    if (end < 0) continue;
    const key = src.slice(start, end);
    if (key && !key.includes('\n')) keys.add(key);
  }
  return keys;
}

const STOP_WORDS =
  /\b(const|let|var|return|null|undefined|function|import|export|typeof|interface|extends|await|async|new)\b/;
/** Values that render but are not prose: an email or URL example carries no language. */
const NOT_PROSE = /^(?:[^\s@]+@[^\s@]+\.[^\s@]+|https?:\/\/\S+)$/;
/** JSX props whose value is read by a human. */
const LABEL_PROPS =
  'label|title|placeholder|aria-label|ariaLabel|heading|description|emptyMessage|confirmLabel|cancelLabel|submitLabel|alt|helpText|hint|message|actionLabel|sub|emptyTitle|emptySub';
/** Object-literal fields that end up on screen — column definitions, status maps, nav entries. */
const LABEL_FIELDS =
  'label|title|description|placeholder|header|helpText|emptyMessage|sub|emptyTitle|emptySub|message';

const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;

/**
 * An auditable opt-out, deliberately shaped like the `eslint-disable` already carried at
 * `ProjectDetailHeader.tsx:75`: a REASON is mandatory, so an exemption stays reviewable instead
 * of becoming a silent mute. The real case this exists for is an export-only column header —
 * FR-L10N-050 forbids `t()` on anything an export writes, so those strings must NOT be
 * extracted, and no narrowing of the rules above can tell them from rendered ones.
 */
const EXEMPT = /i18n-exempt:\s*\S/;
function exemptAt(lines, lineNo) {
  const self = lines[lineNo - 1] ?? '';
  const prev = lines[lineNo - 2] ?? '';
  return EXEMPT.test(self) || EXEMPT.test(prev);
}

/**
 * Rendered English that never became a key, in one file.
 *
 * Three shapes, matching the extraction survey in the spec (§3): JSX prose text nodes, label-
 * bearing JSX props, and label-ish object-literal fields. A string that is already inside a
 * `t(key, default)` call cannot match any of them — the default sits in argument position, not
 * in a text node or a `label=` / `label:` slot — which is what makes "extracted" the passing
 * state rather than something the gate has to prove separately.
 */
export function findUnextracted(src) {
  const stripped = blankComments(src);
  const lines = src.split('\n');
  const found = [];
  const push = (idx, kind, text) => {
    const line = lineOf(src, idx);
    if (exemptAt(lines, line)) return;
    found.push({ line, kind, text });
  };

  // 1. JSX text nodes: `>…<` with the `{…}` expression containers removed.
  const textRe = />([^<>]*)</g;
  let m;
  while ((m = textRe.exec(stripped))) {
    // `=>` — the `>` of an arrow function closes nothing. Without this, the generic in
    // `(d: Map<string, number>) => Column<T>[]` reads as the rendered text "Column".
    if (m.index > 0 && stripped[m.index - 1] === '=') continue;
    const start = m.index + 1;
    const raw = src.slice(start, start + m[1].length);
    let text = '';
    let depth = 0;
    for (const ch of raw) {
      if (ch === '{') {
        depth++;
        continue;
      }
      if (ch === '}') {
        if (depth) depth--;
        continue;
      }
      if (!depth) text += ch;
    }
    text = text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (!/[A-Za-z]{2}/.test(text)) continue; // punctuation, digits, a lone separator
    if (/[;=()&|]/.test(text)) continue; // code, not prose
    if (STOP_WORDS.test(text)) continue;
    if (/^[:.?]/.test(text)) continue; // a ternary or type fragment
    // A leading comma is usually a type-argument fragment (`Array<Foo>, Bar<Baz>` → ", Bar"),
    // but it is also how an interleaved prose fragment starts (", requested by "). Keep it only
    // when a lowercase word survives, which an identifier list does not have.
    if (/^,/.test(text) && !/(^|\s)[a-z]{2,}(\s|$)/.test(text.replace(/^,\s*/, ''))) continue;
    if (NOT_PROSE.test(text)) continue;
    push(start, 'jsx-text', text);
  }

  // 2. Label-bearing JSX props with a bare string value. `label={t('k', 'X')}` cannot match:
  //    its value starts with `{`, not a quote.
  for (const p of stripped.matchAll(new RegExp(`\\b(${LABEL_PROPS})\\s*=\\s*(['"])([^'"\\n]*)\\2`, 'g'))) {
    const value = src.slice(p.index + p[0].indexOf(p[2]) + 1, p.index + p[0].length - 1).trim();
    if (!/[A-Za-z]{2}/.test(value) || NOT_PROSE.test(value)) continue;
    push(p.index, 'jsx-prop', `${p[1]}="${value}"`);
  }

  // 3. Object-literal label fields with a bare string value.
  for (const f of stripped.matchAll(new RegExp(`\\b(${LABEL_FIELDS})\\s*:\\s*(['"])([^'"\\n]*)\\2`, 'g'))) {
    const value = src.slice(f.index + f[0].indexOf(f[2]) + 1, f.index + f[0].length - 1).trim();
    if (!/[A-Za-z]{2}/.test(value) || NOT_PROSE.test(value)) continue;
    push(f.index, 'object-field', `${f[1]}: '${value}'`);
  }

  return found.sort((a, b) => a.line - b.line);
}

/** `{a: {b: 'x'}}` → `['a.b']`. Plural suffixes are ordinary keys; i18next resolves them itself. */
export function flattenCatalogue(node, prefix = '', out = []) {
  for (const [k, v] of Object.entries(node)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flattenCatalogue(v, key, out);
    else out.push(key);
  }
  return out;
}

/** `{a: {b: 'x'}}` → `Map('a.b' → 'x')` — the value-preserving flatten the id half needs, because
 *  "present but empty" and "absent" are different defects with the same rendered symptom. */
export function flattenCatalogueEntries(node, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(node)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flattenCatalogueEntries(v, key, out);
    else out.set(key, v);
  }
  return out;
}

// ── The analyser ────────────────────────────────────────────────────────────────────────────

/**
 * The whole check, over in-memory inputs so the self-test can exercise THIS function rather
 * than a re-implementation of it. A gate whose self-test tests a copy proves nothing about the
 * gate — that is the `check-edge-fn-test-binding` rule applied to this script itself.
 *
 * @param launchScopeFiles {Record<string,string>} rel path → source, the routed screens
 * @param referenceFiles   {Record<string,string>} rel path → source, the whole app
 * @param catalogue        {object} the parsed `en` catalogue
 */
export function analyse({ launchScopeFiles, referenceFiles, catalogue }) {
  const catalogueKeys = flattenCatalogue(catalogue);
  const known = new Set(catalogueKeys);

  const unextracted = [];
  const missing = [];
  for (const [file, src] of Object.entries(launchScopeFiles)) {
    for (const hit of findUnextracted(src)) unextracted.push({ file, ...hit });
    for (const key of collectKeyRefs(src)) {
      if (!known.has(key)) missing.push({ file, key });
    }
  }

  const referenced = new Set();
  for (const src of Object.values(referenceFiles)) {
    for (const key of collectKeyRefs(src)) referenced.add(key);
  }
  const orphans = catalogueKeys.filter((k) => !referenced.has(k));

  return { unextracted, missing, orphans, catalogueKeys };
}

/**
 * The id half (FR-L10N-042b, DD-I18N-9 stage 2), over in-memory inputs for the same self-test-
 * binding reason as `analyse`.
 *
 * The launch-scope set is every key a launch-scope screen references that the en catalogue holds
 * — a key en does NOT hold is the en gate's `missing` finding, and double-reporting it here would
 * blame the translation for an extraction gap. Two id-side defects:
 *
 *   UNTRANSLATED — a launch-scope key absent from id, or present with an empty value. Both render
 *   as the English fallback (FR-L10N-041), so neither is visible at runtime.
 *   EXTRANEOUS   — an id key en does not hold. The id tree mirrors en's exactly; a key with no en
 *   counterpart translates text that no longer exists and counts as coverage while doing it.
 */
export function analyseId({ launchScopeFiles, catalogue, idCatalogue }) {
  const enKeys = new Set(flattenCatalogue(catalogue));
  const idMap = flattenCatalogueEntries(idCatalogue);

  const scopeKeys = new Set();
  for (const src of Object.values(launchScopeFiles)) {
    for (const key of collectKeyRefs(src)) if (enKeys.has(key)) scopeKeys.add(key);
  }

  const untranslated = [];
  for (const key of [...scopeKeys].sort()) {
    const v = idMap.get(key);
    if (v === undefined) untranslated.push({ key, why: 'absent' });
    else if (typeof v === 'string' && !v.trim()) untranslated.push({ key, why: 'empty' });
  }

  const extraneous = [...idMap.keys()].filter((k) => !enKeys.has(k)).sort();

  return { untranslated, extraneous, scopeKeyCount: scopeKeys.size, idKeyCount: idMap.size };
}

// ── Disk plumbing ───────────────────────────────────────────────────────────────────────────

export function parseRouteList(text) {
  const entries = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [route, ...files] = line.split(/\s+/);
    if (!files.length) {
      throw new Error(`launch-scope-routes.txt: route "${route}" names no file`);
    }
    entries.push({ route, files });
  }
  return entries;
}

const isTestFile = (p) => /\.test\.[cm]?[jt]sx?$/.test(p) || p.includes('__tests__');

function expandEntryFile(spec) {
  if (!spec.endsWith('/*.tsx')) return [spec];
  const dir = spec.slice(0, -'/*.tsx'.length);
  const abs = path.join(APP, dir);
  if (!fs.existsSync(abs)) throw new Error(`launch-scope-routes.txt: no such directory "${dir}"`);
  return fs
    .readdirSync(abs)
    .filter((f) => f.endsWith('.tsx') && !isTestFile(f))
    .sort()
    .map((f) => `${dir}/${f}`);
}

function walkSources(abs, out = []) {
  if (!fs.existsSync(abs)) return out;
  if (fs.statSync(abs).isFile()) {
    if (/\.tsx?$/.test(abs) && !isTestFile(abs)) out.push(abs);
    return out;
  }
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const p = path.join(abs, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === '__tests__') continue;
      walkSources(p, out);
    } else if (/\.tsx?$/.test(e.name) && !isTestFile(e.name)) {
      out.push(p);
    }
  }
  return out;
}

function readFromDisk() {
  const entries = parseRouteList(fs.readFileSync(ROUTE_LIST, 'utf8'));
  const launchScopeFiles = {};
  for (const entry of entries) {
    for (const spec of entry.files) {
      for (const rel of expandEntryFile(spec)) {
        const abs = path.join(APP, rel);
        if (!fs.existsSync(abs)) {
          throw new Error(
            `launch-scope-routes.txt: route "${entry.route}" names "${rel}", which does not exist`,
          );
        }
        launchScopeFiles[rel] ??= fs.readFileSync(abs, 'utf8');
      }
    }
  }

  const referenceFiles = {};
  for (const root of REFERENCE_ROOTS) {
    for (const abs of walkSources(path.join(APP, root))) {
      referenceFiles[path.relative(APP, abs)] = fs.readFileSync(abs, 'utf8');
    }
  }

  const catalogue = JSON.parse(fs.readFileSync(EN_CATALOGUE, 'utf8'));
  return { entries, launchScopeFiles, referenceFiles, catalogue };
}

/** --id mode ONLY. Kept out of `readFromDisk` so the en-side gate stays structurally incapable
 *  of depending on translation state — the self-test asserts this separation. */
function readIdFromDisk() {
  return JSON.parse(fs.readFileSync(ID_CATALOGUE, 'utf8'));
}

// ── Reporting ───────────────────────────────────────────────────────────────────────────────

function report(result, entries, fileCount) {
  const { unextracted, missing, orphans, catalogueKeys } = result;
  let failed = false;

  if (unextracted.length) {
    failed = true;
    console.error(
      `\n✗ ${unextracted.length} rendered string(s) on a launch-scope screen are NOT extracted.`,
    );
    console.error(
      `  Wrap each in t('<namespace>.<key>', '<the English text>') and add the key to`,
    );
    console.error(`  pmo-portal/public/locales/en/common.json.`);
    console.error(
      `  If it is NOT rendered — an export-only column header, say (FR-L10N-050 forbids t() on`,
    );
    console.error(
      `  export values) — annotate the line with a reason: // i18n-exempt: <why>\n`,
    );
    for (const u of unextracted) {
      console.error(`  pmo-portal/${u.file}:${u.line}  [${u.kind}]  ${u.text}`);
    }
  }

  if (missing.length) {
    failed = true;
    console.error(`\n✗ ${missing.length} key(s) referenced by a launch-scope screen are absent`);
    console.error(`  from the en catalogue. They render as their English default today, so`);
    console.error(`  nothing looks broken — and nothing will ever translate them.\n`);
    for (const m of missing) console.error(`  pmo-portal/${m.file}  →  ${m.key}`);
  }

  if (orphans.length) {
    failed = true;
    console.error(`\n✗ ${orphans.length} orphaned key(s): present in the en catalogue, referenced`);
    console.error(`  by no source file. They point at text that no longer exists, and they count`);
    console.error(`  as coverage while doing it. Delete them, or restore the call site.\n`);
    for (const k of orphans) console.error(`  ${k}`);
  }

  if (failed) {
    console.error(`\nFR-L10N-042a — the en-side i18n completeness gate. See`);
    console.error(`pmo-portal/src/lib/i18n/launch-scope-routes.txt for what is in scope and why.`);
    return 1;
  }

  console.log(
    `✓ i18n completeness (en): ${entries.length} launch-scope route(s) / ${fileCount} file(s), ` +
      `${catalogueKeys.length} catalogue key(s) — none unextracted, none missing, none orphaned.`,
  );
  return 0;
}

function reportId(result, entries, fileCount) {
  const { untranslated, extraneous, scopeKeyCount, idKeyCount } = result;
  let failed = false;

  if (untranslated.length) {
    failed = true;
    console.error(
      `\n✗ ${untranslated.length} launch-scope key(s) are not translated in the id catalogue.`,
    );
    console.error(`  A missing or empty id value renders as its English fallback (FR-L10N-041),`);
    console.error(`  so nothing looks broken — and a client reads English. Add each key to`);
    console.error(`  pmo-portal/public/locales/id/common.json with a non-empty translation.\n`);
    for (const u of untranslated) console.error(`  ${u.key}  (${u.why})`);
  }

  if (extraneous.length) {
    failed = true;
    console.error(`\n✗ ${extraneous.length} id key(s) have no en counterpart. The id tree mirrors`);
    console.error(`  en's exactly — these translate text that no longer exists, and they count as`);
    console.error(`  coverage while doing it. Delete them, or restore the en key.\n`);
    for (const k of extraneous) console.error(`  ${k}`);
  }

  if (failed) {
    console.error(`\nFR-L10N-042b — the id-side i18n completeness gate (DD-I18N-9 stage 2). See`);
    console.error(`pmo-portal/src/lib/i18n/launch-scope-routes.txt for what is in scope and why.`);
    return 1;
  }

  console.log(
    `✓ i18n completeness (id): ${entries.length} launch-scope route(s) / ${fileCount} file(s), ` +
      `${scopeKeyCount} launch-scope key(s) all translated non-empty; ` +
      `${idKeyCount} id key(s), none without an en counterpart.`,
  );
  return 0;
}

// ── Self-test ───────────────────────────────────────────────────────────────────────────────

/**
 * ⚑ The fixtures below are ASSEMBLED AT RUNTIME, never written as whole literals.
 *
 * This script lives inside the tree it scans. A fixture written literally — a planted key as a
 * real `t('probe.missing', …)` call, a planted orphan spelled out in full — could be picked up
 * by the very scan it is meant to test the moment the reference roots widen or this file moves,
 * and a planted defect that reads as legitimately referenced turns a red self-test green while
 * looking correct. Splitting the strings makes that impossible by construction rather than by
 * remembering where the script sits.
 */
function selfTest() {
  const T = 't';
  const Q = "'";
  const k = (...parts) => parts.join('.');
  const call = (key, def) => `${T}(${Q}${key}${Q}, ${Q}${def}${def ? '' : ''}${Q})`;

  const NS = ['probe', 'fixture'].join('');
  const OK_KEY = k(NS, 'greeting');
  const PLANTED_KEY = k(NS, ['un', 'known'].join(''));
  const ORPHAN_KEY = k(NS, ['dead', 'Text'].join(''));
  const RAW = ['Unwrapped', 'launch', 'scope', 'copy'].join(' ');

  const clean = {
    launchScopeFiles: {
      'pages/Probe.tsx': `export const P = () => <p>{${call(OK_KEY, 'Hello there')}}</p>;\n`,
    },
    referenceFiles: {
      'pages/Probe.tsx': `export const P = () => <p>{${call(OK_KEY, 'Hello there')}}</p>;\n`,
    },
    catalogue: { [NS]: { greeting: 'Hello there' } },
  };

  const cases = [];
  const check = (name, ok, detail) => cases.push({ name, ok, detail });

  // 0. Clean fixture passes — the control. Without it, a self-test that only plants defects
  //    would still pass if the analyser reported EVERYTHING as broken.
  {
    const r = analyse(clean);
    check(
      'a clean catalogue passes',
      !r.unextracted.length && !r.missing.length && !r.orphans.length,
      `unextracted=${r.unextracted.length} missing=${r.missing.length} orphans=${r.orphans.length}`,
    );
  }

  // 1. Plant a MISSING key: a launch-scope screen references a key the catalogue does not hold.
  {
    const src = `export const P = () => <p>{${call(PLANTED_KEY, 'Nowhere')}}</p>;\n`;
    const r = analyse({
      ...clean,
      launchScopeFiles: { 'pages/Probe.tsx': src },
      referenceFiles: { 'pages/Probe.tsx': src, ...clean.referenceFiles },
    });
    check(
      'a missing key fails the gate',
      r.missing.some((m) => m.key === PLANTED_KEY),
      `missing=${JSON.stringify(r.missing.map((m) => m.key))}`,
    );
  }

  // 2. Plant an ORPHAN: a catalogue key no source file references.
  {
    const r = analyse({
      ...clean,
      catalogue: { [NS]: { greeting: 'Hello there', deadText: 'Text nothing renders' } },
    });
    check(
      'an orphaned key fails the gate',
      r.orphans.includes(ORPHAN_KEY),
      `orphans=${JSON.stringify(r.orphans)}`,
    );
  }

  // 3. Plant an UNEXTRACTED rendered string — the half a key-only check cannot see. A JSX text
  //    node and a label prop, because they are found by different rules.
  {
    const DQ = String.fromCharCode(34);
    const src =
      `export const P = () => <p>${RAW}</p>;\n` +
      `export const Q = () => <Field label=${DQ}${RAW}${DQ} />;\n`;
    const r = analyse({ ...clean, launchScopeFiles: { 'pages/Probe.tsx': src } });
    check(
      'an unextracted JSX text node fails the gate',
      r.unextracted.some((u) => u.kind === 'jsx-text' && u.text === RAW),
      `unextracted=${JSON.stringify(r.unextracted)}`,
    );
    check(
      'an unextracted label prop fails the gate',
      r.unextracted.some((u) => u.kind === 'jsx-prop'),
      `unextracted=${JSON.stringify(r.unextracted)}`,
    );
  }

  // 4. An extracted string does NOT fail — the false-positive control. Without this, a rule that
  //    flags every string would pass cases 3 and still be useless.
  {
    const src = `export const P = () => <p>{${call(OK_KEY, RAW)}}</p>;\n`;
    const r = analyse({ ...clean, launchScopeFiles: { 'pages/Probe.tsx': src } });
    check(
      'an already-extracted string does not fail',
      !r.unextracted.length,
      `unextracted=${JSON.stringify(r.unextracted)}`,
    );
  }

  // 5. A comment is not a call site. `src/lib/i18n/index.ts` documents the convention in prose;
  //    counted as a reference, the illustration becomes a phantom missing key.
  {
    const src = `// see ${call(k(NS, 'illustration'), 'Example')} for the convention\n`;
    const r = analyse({ ...clean, launchScopeFiles: { 'pages/Probe.tsx': src } });
    check('a key inside a comment is not a reference', !r.missing.length, `missing=${r.missing.length}`);
  }

  // 6. The exemption needs a reason. A bare marker must NOT mute a finding.
  {
    const muted = `// i18n-exempt: export-only, FR-L10N-050\nexport const P = () => <p>${RAW}</p>;\n`;
    const bare = `// i18n-exempt:\nexport const P = () => <p>${RAW}</p>;\n`;
    const rMuted = analyse({ ...clean, launchScopeFiles: { 'pages/Probe.tsx': muted } });
    const rBare = analyse({ ...clean, launchScopeFiles: { 'pages/Probe.tsx': bare } });
    check('an exemption WITH a reason mutes the finding', !rMuted.unextracted.length, '');
    check(
      'an exemption WITHOUT a reason does not mute it',
      rBare.unextracted.length > 0,
      `unextracted=${rBare.unextracted.length}`,
    );
  }

  // 7. Mode separation — EVOLVED for DD-I18N-9 stage 2. Stage 1's assertion was "the gate never
  //    reads `id` at all" (`id` shipped empty, so any id check would have been permanently red).
  //    Stage 2 arrived WITH the populated catalogue, so the ruling is now two-sided: the en-side
  //    loader still must not read `id` (en completeness must never depend on translation state),
  //    and the id-side loader must actually read it (a stage-2 gate that silently stopped
  //    looking at `id` would pass everything while checking nothing).
  {
    const source = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
    const enStart = source.indexOf('function readFromDisk');
    const idStart = source.indexOf('function readIdFromDisk');
    const enLoader = source.slice(enStart, idStart);
    check(
      'the en-side loader never reads the id catalogue (FR-L10N-042a)',
      enStart > 0 && idStart > enStart && !/ID_CATALOGUE|locales\/(?:\$\{[^}]*\}|id)\//.test(enLoader),
      '',
    );
    const idLoaderBody = idStart > 0 ? source.slice(idStart, source.indexOf('}', idStart) + 1) : '';
    check(
      'the id-side loader reads the id catalogue (FR-L10N-042b, stage 2)',
      /ID_CATALOGUE/.test(idLoaderBody) && /locales\/id\//.test(source),
      '',
    );
  }

  // 8. Stage 2 (FR-L10N-042b): the id half, same fixture discipline — a clean control first,
  //    then each planted defect class must redden the analyser.
  {
    const idOf = (v) => ({ [NS]: { greeting: v } });
    const base = { launchScopeFiles: clean.launchScopeFiles, catalogue: clean.catalogue };

    const rClean = analyseId({ ...base, idCatalogue: idOf('Halo') });
    check(
      'a fully translated id catalogue passes',
      !rClean.untranslated.length && !rClean.extraneous.length,
      `untranslated=${rClean.untranslated.length} extraneous=${rClean.extraneous.length}`,
    );

    const rAbsent = analyseId({ ...base, idCatalogue: { [NS]: {} } });
    check(
      'a launch-scope key ABSENT from id fails the gate',
      rAbsent.untranslated.some((u) => u.key === OK_KEY && u.why === 'absent'),
      `untranslated=${JSON.stringify(rAbsent.untranslated)}`,
    );

    const rEmpty = analyseId({ ...base, idCatalogue: idOf('   ') });
    check(
      'a launch-scope key EMPTY in id fails the gate',
      rEmpty.untranslated.some((u) => u.key === OK_KEY && u.why === 'empty'),
      `untranslated=${JSON.stringify(rEmpty.untranslated)}`,
    );

    const rExtra = analyseId({
      ...base,
      idCatalogue: { [NS]: { greeting: 'Halo', deadText: 'Terjemahan tanpa sumber' } },
    });
    check(
      'an id key en does not hold fails the gate',
      rExtra.extraneous.includes(ORPHAN_KEY),
      `extraneous=${JSON.stringify(rExtra.extraneous)}`,
    );

    // Scope control: an en key OUTSIDE launch scope may stay untranslated (DD-I18N-9's additive
    // staging). Without this, a rule demanding the whole catalogue would pass every red case
    // above — and gate features that have not shipped their route-list line yet.
    const rScope = analyseId({
      launchScopeFiles: clean.launchScopeFiles,
      catalogue: { [NS]: { greeting: 'Hello there', notYet: 'Ships later' } },
      idCatalogue: idOf('Halo'),
    });
    check(
      'an en key outside launch scope may stay untranslated',
      !rScope.untranslated.length,
      `untranslated=${JSON.stringify(rScope.untranslated)}`,
    );
  }

  const failures = cases.filter((c) => !c.ok);
  for (const c of cases) {
    console.log(`  ${c.ok ? '✓' : '✗'} ${c.name}${c.ok || !c.detail ? '' : `  — ${c.detail}`}`);
  }
  if (failures.length) {
    console.error(`\n✗ self-test: ${failures.length}/${cases.length} failed.`);
    console.error(`  The gate does not detect what it claims to. Do NOT trust a green run.`);
    return 1;
  }
  console.log(`✓ self-test: ${cases.length}/${cases.length} — the gate reddens on every planted defect.`);
  return 0;
}

// ── Entry ───────────────────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) {
    process.exit(selfTest());
  }
  if (process.argv.includes('--id')) {
    const { entries, launchScopeFiles, catalogue } = readFromDisk();
    const result = analyseId({ launchScopeFiles, catalogue, idCatalogue: readIdFromDisk() });
    process.exit(reportId(result, entries, Object.keys(launchScopeFiles).length));
  }
  const { entries, launchScopeFiles, referenceFiles, catalogue } = readFromDisk();
  const result = analyse({ launchScopeFiles, referenceFiles, catalogue });
  process.exit(report(result, entries, Object.keys(launchScopeFiles).length));
}
