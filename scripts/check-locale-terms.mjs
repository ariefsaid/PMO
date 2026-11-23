#!/usr/bin/env node
/**
 * Guard: the locale catalogues and the term registry agree (#2799).
 *
 * An Admin's rename reaches a screen by rewriting the shipped wording (src/lib/i18n/orgTerms.ts), so a catalogue string
 * only follows a rename when it spells the term the way the registry lists it. The registry is one file,
 * pmo-portal/src/lib/i18n/terms.registry.json. Rules, over every leaf string of pmo-portal/public/locales/{en,id}/*.json:
 *   R1  a known variant spelling of a term (registry `variants`) is a literal the rewriter cannot reach: fail.
 *   R2  a registry term with no matching text in a language is dead there (a rename changes nothing): fail.
 *   R3  the registry keys equal the TERM_KEYS tuple, the keys the migrations insert into org_term_keys, and the
 *       Administration list (which renders TERM_KEYS).
 * Allowlist scripts/locale-terms-allowlist.json: { file, key, rule, term, reason } per entry. R1 entries name the
 * locale file and the leaf key; R2 entries name `pmo-portal/public/locales/<lang>` and the registry key. An entry needs
 * a non-empty reason and fails as STALE when it no longer matches a violation, so the list only shrinks.
 *
 * Run: node scripts/check-locale-terms.mjs | --self-test
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = 'pmo-portal/src/lib/i18n/terms.registry.json';
const LOCALES = 'pmo-portal/public/locales';
const ALLOWLIST = 'scripts/locale-terms-allowlist.json';
const LANGS = ['en', 'id'];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whole-word, case-insensitive, longest form first (the rewriter's own matching). */
export const formsRegex = (forms) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${[...new Set(forms)].sort((a, b) => b.length - a.length).map(escapeRe).join('|')})(?![\\p{L}\\p{N}])`, 'iu');

/** Leaf strings of one catalogue: [{ key: 'a.b.c', text }]. */
export function leaves(obj, prefix = '') {
  const out = [];
  if (typeof obj === 'string') out.push({ key: prefix, text: obj });
  else if (obj && typeof obj === 'object') for (const [k, v] of Object.entries(obj)) out.push(...leaves(v, prefix ? `${prefix}.${k}` : k));
  return out;
}

/**
 * Pure check. input: { registry, catalogues: { en: { '<ns>.json': object }, id: {...} }, termKeys: string[], seedKeys: string[],
 * adminListsTermKeys: boolean, allowlist: entry[] }. Returns failure lines.
 */
export function check({ registry, catalogues, termKeys, seedKeys, adminListsTermKeys, allowlist }) {
  const fails = [];
  const violations = []; // { id, file, key, rule, term, line }
  for (const lang of LANGS) {
    const files = Object.entries(catalogues[lang] ?? {});
    const values = files.flatMap(([file, obj]) => leaves(obj).map((l) => ({ file: `${LOCALES}/${lang}/${file}`, ...l })));
    for (const term of registry.terms) {
      const variants = term.variants?.[lang] ?? [];
      if (variants.length) {
        const re = formsRegex(variants);
        for (const v of values) if (re.test(v.text)) violations.push({ file: v.file, key: v.key, rule: 'R1', term: term.key, line: `${v.file} ${v.key}: "${v.text.slice(0, 60)}" spells ${term.key} as a variant the rewriter cannot reach (${lang})` });
      }
      const shipped = formsRegex([...term[lang].singular, ...term[lang].plural]);
      if (!values.some((v) => shipped.test(v.text))) violations.push({ file: `${LOCALES}/${lang}`, key: term.key, rule: 'R2', term: term.key, line: `${term.key} (${lang}): no catalogue text uses a shipped form, so a rename changes nothing` });
    }
  }
  const keys = registry.terms.map((t) => t.key);
  const same = (a, b) => a.length === b.length && [...a].sort().every((k, i) => k === [...b].sort()[i]);
  const diff = (a, b) => [...a].filter((k) => !b.includes(k));
  if (new Set(keys).size !== keys.length) fails.push('R3 registry repeats a key');
  if (!same(keys, termKeys)) fails.push(`R3 TERM_KEYS differs from the registry (only in registry: ${diff(keys, termKeys).join(',') || '-'}; only in TERM_KEYS: ${diff(termKeys, keys).join(',') || '-'})`);
  if (!same(keys, seedKeys)) fails.push(`R3 migrations seed differs from the registry (only in registry: ${diff(keys, seedKeys).join(',') || '-'}; only in migrations: ${diff(seedKeys, keys).join(',') || '-'})`);
  if (!adminListsTermKeys) fails.push('R3 the Administration terminology list no longer renders TERM_KEYS');

  const matched = new Set();
  for (const v of violations) {
    const i = allowlist.findIndex((e) => e.file === v.file && e.key === v.key && e.rule === v.rule && e.term === v.term);
    if (i >= 0 && typeof allowlist[i].reason === 'string' && allowlist[i].reason.trim()) matched.add(i);
    else fails.push(`${v.rule} ${v.line}`);
  }
  allowlist.forEach((e, i) => {
    if (typeof e.reason !== 'string' || !e.reason.trim()) fails.push(`allowlist entry ${e.rule} ${e.file} ${e.key} ${e.term} has no reason`);
    else if (!matched.has(i)) fails.push(`allowlist entry ${e.rule} ${e.file} ${e.key} ${e.term} is stale (it matches no violation): delete it`);
  });
  return fails;
}

function load() {
  const read = (p) => JSON.parse(readFileSync(resolve(REPO, p), 'utf8'));
  const catalogues = {};
  for (const lang of LANGS) {
    catalogues[lang] = {};
    const dir = resolve(REPO, LOCALES, lang);
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) catalogues[lang][f] = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  }
  const src = readFileSync(resolve(REPO, 'pmo-portal/src/lib/i18n/orgTerms.ts'), 'utf8');
  const tuple = /export const TERM_KEYS = \[([\s\S]*?)\] as const/.exec(src);
  const termKeys = tuple ? [...tuple[1].replace(/\/\/.*$/gm, '').matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]) : [];
  const migDir = resolve(REPO, 'supabase/migrations');
  const seedKeys = [];
  for (const f of readdirSync(migDir).filter((n) => n.endsWith('.sql'))) {
    const sql = readFileSync(join(migDir, f), 'utf8');
    for (const m of sql.matchAll(/insert\s+into\s+public\.org_term_keys\s*\(term_key\)\s*values([\s\S]*?)(?:on\s+conflict[^;]*)?;/gi)) {
      seedKeys.push(...[...m[1].matchAll(/\('([A-Za-z]+)'\)/g)].map((k) => k[1]));
    }
  }
  const admin = readFileSync(resolve(REPO, 'pmo-portal/pages/AdministrationTerminology.tsx'), 'utf8');
  return {
    registry: read(REGISTRY), catalogues, termKeys, seedKeys,
    adminListsTermKeys: /TERM_KEYS\.map\(/.test(admin),
    allowlist: existsSync(resolve(REPO, ALLOWLIST)) ? read(ALLOWLIST) : [],
  };
}

function selfTest() {
  const registry = { terms: [
    { key: 'crew', en: { singular: ['crew'], plural: ['crews'] }, id: { singular: ['kru'], plural: ['kru'] }, variants: { en: [], id: ['regu'] } },
    { key: 'imprest', en: { singular: ['site cash'], plural: ['site cash'] }, id: { singular: ['kas lapangan'], plural: ['kas lapangan'] }, variants: { en: ['petty cash'], id: [] } },
  ] };
  const clean = () => ({
    registry,
    catalogues: { en: { 'a.json': { x: 'The crew and site cash', y: { z: 'Crews' } } }, id: { 'a.json': { x: 'Kru dan kas lapangan' } } },
    termKeys: ['crew', 'imprest'], seedKeys: ['crew', 'imprest'], adminListsTermKeys: true, allowlist: [],
  });
  const expect = (name, input, test) => {
    const fails = check(input);
    if (!test(fails)) throw new Error(`self-test failed: ${name}: ${JSON.stringify(fails)}`);
  };
  expect('clean input passes', clean(), (f) => f.length === 0);
  const r1 = clean(); r1.catalogues.id['a.json'].x = 'Regu dan kas lapangan';
  expect('R1 variant spelling fails', r1, (f) => f.length === 2 && f.some((l) => l.startsWith('R1 ') && l.includes('a.json x') && l.includes('crew')) && f.some((l) => l.includes('crew (id)')));
  const r1b = clean(); r1b.catalogues.id['a.json'].x = 'Kru dan kas lapangan, regu'; r1b.allowlist = [{ file: `${LOCALES}/id/a.json`, key: 'x', rule: 'R1', term: 'crew', reason: 'a legacy page names the squad' }];
  expect('R1 allowlisted passes', r1b, (f) => f.length === 0);
  const r2 = clean(); r2.catalogues.en['a.json'] = { x: 'The crew' };
  expect('R2 dead key fails', r2, (f) => f.length === 1 && f[0].startsWith('R2 ') && f[0].includes('imprest (en)'));
  const r2b = clean(); r2b.catalogues.en['a.json'] = { x: 'The crew' }; r2b.allowlist = [{ file: `${LOCALES}/en`, key: 'imprest', rule: 'R2', term: 'imprest', reason: 'no screen names it yet' }];
  expect('R2 allowlisted passes', r2b, (f) => f.length === 0);
  const stale = clean(); stale.allowlist = [{ file: `${LOCALES}/en/a.json`, key: 'x', rule: 'R1', term: 'imprest', reason: 'was needed once' }];
  expect('a stale entry fails', stale, (f) => f.length === 1 && f[0].includes('stale'));
  const noReason = clean(); noReason.catalogues.en['a.json'].y.z = 'Petty cash'; noReason.allowlist = [{ file: `${LOCALES}/en/a.json`, key: 'y.z', rule: 'R1', term: 'imprest', reason: '  ' }];
  expect('an entry with no reason fails and does not excuse the violation', noReason, (f) => f.some((l) => l.includes('has no reason')) && f.some((l) => l.startsWith('R1 ')));
  const r3 = clean(); r3.termKeys = ['crew']; r3.seedKeys = ['crew', 'imprest', 'extra']; r3.adminListsTermKeys = false;
  expect('R3 disagreement fails (tuple, seed, admin list)', r3, (f) => f.length === 3 && f.every((l) => l.startsWith('R3 ')));
  console.log('check-locale-terms self-test: ok');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--self-test')) selfTest();
  else {
    const input = load();
    const fails = check(input);
    if (fails.length) {
      console.error(fails.join('\n'));
      process.exit(1);
    }
    console.log(`check-locale-terms: ok (${input.registry.terms.length} terms, ${input.allowlist.length} allowlisted)`);
  }
}
