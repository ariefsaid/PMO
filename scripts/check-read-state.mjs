#!/usr/bin/env node
/**
 * Guard: no screen treats absent query data (`data ?? []` or `data = []`) as a complete empty list (#2976).
 *
 * Every list and detail screen must distinguish loading, retryable error (keeping any loaded data),
 * and a genuine empty read (via `<ReadState>` / `resolveReadState` or explicit `isError`/`error` handling).
 *
 * Detects in `pmo-portal/pages/**\/*.tsx` (non-test):
 *   1. `const { ... data = [] ... } = useX(...)` (or `data: alias = []`) without `isError` or `error`
 *      in the same destructuring.
 *   2. `const q = useX(...)` where `q.data ?? []` is treated as an empty list or table rows
 *      (`(q.data ?? []).length === 0`, `!(q.data ?? []).length`, `rows={q.data ?? []}`, or an alias
 *      `const rows = q.data ?? []` checked with `rows.length === 0` / `!rows.length` / `rows={rows}`)
 *      with no `q.isError`, `q.error`, `<ReadState query={q}`, or `resolveReadState(q)` in the file.
 *
 * Every pre-existing allowlisted site is listed in ALLOWLIST with a reason. A NEW offender fails;
 * a STALE allowlist entry fails too.
 *
 * Run: node scripts/check-read-state.mjs [--self-test]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative } from 'node:path';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PAGES_DIR = 'pmo-portal/pages';

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Offender keys for one source text. */
export function findOffenders(file, src) {
  const out = [];
  const seen = new Set();
  const add = (key) => {
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  };

  // 1. Destructured default-empty query data without error handling in the same destructuring.
  for (const m of src.matchAll(/const\s*\{([^}]+)\}\s*=\s*(use[A-Z]\w*)\s*\(/g)) {
    const [, props, hook] = m;
    if (/\bdata\b[^,}]*=\s*\[\]/.test(props) && !/\b(isError|error)\b/.test(props)) {
      add(`${file} :: ${hook} (destructure data = [])`);
    }
  }

  // 2. Query variable whose `data ?? []` is treated as an empty list or table rows without error handling.
  for (const m of src.matchAll(/const\s+(\w+)\s*=\s*(use[A-Z]\w*)\s*\(/g)) {
    const [, v, hook] = m;
    const ev = escapeRe(v);
    if (!new RegExp(`\\b${ev}\\.data\\s*\\?\\?\\s*\\[\\]`).test(src)) continue;

    const handled = new RegExp(`\\b${ev}\\.(isError|error)\\b`).test(src)
      || new RegExp(`<ReadState\\b[^>]*\\bquery=\\{\\s*${ev}\\s*\\}`).test(src)
      || new RegExp(`\\bresolveReadState\\(\\s*${ev}\\b`).test(src);
    if (handled) continue;

    const directEmpty = new RegExp(
      `\\(\\s*${ev}\\.data\\s*\\?\\?\\s*\\[\\]\\s*\\)\\.length\\s*===\\s*0`
      + `|!\\(\\s*${ev}\\.data\\s*\\?\\?\\s*\\[\\]\\s*\\)\\.length`
      + `|\\brows=\\{\\s*${ev}\\.data\\s*\\?\\?\\s*\\[\\]\\s*\\}`,
    ).test(src);

    let aliasEmpty = false;
    for (const am of src.matchAll(new RegExp(`const\\s+(\\w+)\\s*=\\s*${ev}\\.data\\s*\\?\\?\\s*\\[\\]`, 'g'))) {
      const ea = escapeRe(am[1]);
      if (new RegExp(`\\b${ea}\\.length\\s*===\\s*0|!${ea}\\.length\\b|\\brows=\\{\\s*${ea}\\s*\\}`).test(src)) {
        aliasEmpty = true;
        break;
      }
    }

    if (directEmpty || aliasEmpty) {
      add(`${file} :: ${v} (${hook})`);
    }
  }

  return out;
}

function listFiles(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = resolve(dir, n);
    if (statSync(p).isDirectory()) {
      if (n !== '__tests__') out.push(...listFiles(p));
    } else if (n.endsWith('.tsx') && !n.endsWith('.test.tsx')) {
      out.push(p);
    }
  }
  return out;
}

/** Returns { fresh, stale } given offender keys and the allowlist keys. */
export function compare(offenders, allowKeys) {
  const allow = new Set(allowKeys);
  const found = new Set(offenders);
  return {
    fresh: offenders.filter((k) => !allow.has(k)),
    stale: [...allow].filter((k) => !found.has(k)),
  };
}

/** key -> one-line reason (pre-existing sites not yet migrated). */
const ALLOWLIST = {
  'pmo-portal/pages/crews/ManpowerNeedForm.tsx :: positions (useCostDisciplines)': 'form option list; migrate in follow-up form-lookup batch',
  'pmo-portal/pages/stock/StockSetup.tsx :: people (useStockKeeperCandidates)': 'keeper candidate picker in setup dialog; migrate in follow-up batch',
  'pmo-portal/pages/stock/StockTransferDetail.tsx :: confirmations (useTransferConfirmations)': 'secondary confirmation sub-list; migrate in follow-up batch',
};

function selfTest() {
  const plantedDestructure = `
    export function Bad1() {
      const { data: rows = [] } = useThings();
      return rows.length === 0 ? <p>Empty</p> : <div />;
    }
  `;
  const plantedNullish = `
    export function Bad2() {
      const items = useThings();
      const rows = items.data ?? [];
      return rows.length === 0 ? <p>Empty</p> : <DataTable rows={rows} />;
    }
  `;
  const plantedTableProp = `
    export function Bad3() {
      const items = useThings();
      return <DataTable rows={items.data ?? []} state={(items.data ?? []).length === 0 ? 'empty' : undefined} />;
    }
  `;
  const goodReadState = `
    export function Good1() {
      const items = useThings();
      return <ReadState query={items} errorTitle="Error" empty={<p>Empty</p>}>{(rows) => <DataTable rows={rows} />}</ReadState>;
    }
  `;
  const goodExplicitError = `
    export function Good2() {
      const items = useThings();
      if (items.isError) return <ListState variant="error" onRetry={() => void items.refetch()} />;
      const rows = items.data ?? [];
      return rows.length === 0 ? <p>Empty</p> : <DataTable rows={rows} />;
    }
  `;
  const goodDestructureWithError = `
    export function Good3() {
      const { data: rows = [], isError, refetch } = useThings();
      if (isError) return <ListState variant="error" onRetry={() => void refetch()} />;
      return rows.length === 0 ? <p>Empty</p> : <DataTable rows={rows} />;
    }
  `;

  const fails = [];
  const o1 = findOffenders('Bad1.tsx', plantedDestructure);
  if (o1.join() !== 'Bad1.tsx :: useThings (destructure data = [])') fails.push(`destructure violation not caught: ${o1}`);
  const o2 = findOffenders('Bad2.tsx', plantedNullish);
  if (o2.join() !== 'Bad2.tsx :: items (useThings)') fails.push(`nullish alias violation not caught: ${o2}`);
  const o3 = findOffenders('Bad3.tsx', plantedTableProp);
  if (o3.join() !== 'Bad3.tsx :: items (useThings)') fails.push(`DataTable rows/empty violation not caught: ${o3}`);

  if (findOffenders('Good1.tsx', goodReadState).length) fails.push('ReadState screen falsely flagged');
  if (findOffenders('Good2.tsx', goodExplicitError).length) fails.push('explicit isError screen falsely flagged');
  if (findOffenders('Good3.tsx', goodDestructureWithError).length) fails.push('destructure with isError falsely flagged');

  if (compare(o2, []).fresh.length !== 1) fails.push('new offender not reported');
  if (compare([], ['stale :: x (useX)']).stale.length !== 1) fails.push('stale entry not reported');
  if (compare(o2, o2).fresh.length + compare(o2, o2).stale.length) fails.push('matched allowlist flagged');

  if (fails.length) {
    console.error('check-read-state self-test FAILED:\n  ' + fails.join('\n  '));
    process.exit(1);
  }
  console.log('check-read-state self-test OK');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    selfTest();
  } else {
    const offenders = listFiles(resolve(REPO, PAGES_DIR))
      .sort()
      .flatMap((f) => findOffenders(relative(REPO, f), readFileSync(f, 'utf8')));
    const { fresh, stale } = compare(offenders, Object.keys(ALLOWLIST));
    if (fresh.length || stale.length) {
      for (const k of fresh) {
        console.error(`UNHANDLED READ STATE: ${k}\n  render loading/error/empty via <ReadState> (or handle isError with retry) instead of treating absent data as []`);
      }
      for (const k of stale) {
        console.error(`STALE ALLOWLIST ENTRY: ${k}\n  no longer an offender; remove it`);
      }
      process.exit(1);
    }
    console.log(`check-read-state OK (${offenders.length} allowlisted, 0 new)`);
  }
}
