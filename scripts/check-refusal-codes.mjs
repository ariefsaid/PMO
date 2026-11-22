#!/usr/bin/env node
/**
 * Every refusal code a migration raises (`raise exception 'FAMILY_CODE: sentence'`) must have an English and an
 * Indonesian sentence in the `refusals` namespace, keyed by the full code. Without one the person sees the server's
 * English text with its code prefix, or a generic "refresh and try again" that never helps a rule refusal.
 *
 * Usage:  node scripts/check-refusal-codes.mjs   |   node scripts/check-refusal-codes.mjs --self-test
 * The self-test plants a missing code and an empty sentence and requires the check to go red.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');
const LOCALES = path.join(ROOT, 'pmo-portal/public/locales');
const CODE = /'([A-Z][A-Z0-9]*_[A-Z0-9_]+): /g;

export function raisedCodes(sources) {
  const codes = new Set();
  for (const sql of sources) for (const m of sql.matchAll(CODE)) codes.add(m[1]);
  return [...codes].sort();
}

export function checkRefusals({ codes, en, id }) {
  const errors = [];
  for (const [lang, catalogue] of [['en', en], ['id', id]]) {
    for (const code of codes) {
      const v = catalogue[code];
      if (typeof v !== 'string' || v.trim() === '') errors.push(`${lang}: no sentence for refusal code ${code}`);
    }
  }
  return errors;
}

function load(lang) {
  return JSON.parse(fs.readFileSync(path.join(LOCALES, lang, 'refusals.json'), 'utf8'));
}

function selfTest() {
  const sql = [`raise exception 'AAA_ONE: a thing' using errcode = 'P0001';`, `v_reason := 'BBB_TWO: x' || y;`];
  const codes = raisedCodes(sql);
  if (codes.join() !== 'AAA_ONE,BBB_TWO') throw new Error(`code scan read ${codes.join()}`);
  const ok = { AAA_ONE: 'One.', BBB_TWO: 'Two.' };
  if (checkRefusals({ codes, en: ok, id: ok }).length) throw new Error('a complete catalogue was rejected');
  if (!checkRefusals({ codes, en: { AAA_ONE: 'One.' }, id: ok }).some((e) => e.includes('en:') && e.includes('BBB_TWO'))) throw new Error('a missing en sentence was not detected');
  if (!checkRefusals({ codes, en: ok, id: { ...ok, AAA_ONE: ' ' } }).some((e) => e.includes('id:') && e.includes('AAA_ONE'))) throw new Error('an empty id sentence was not detected');
  console.log('refusal-code gate self-test passed');
}

if (process.argv.includes('--self-test')) selfTest();
else {
  const sources = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).map((f) => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'));
  const codes = raisedCodes(sources);
  const errors = checkRefusals({ codes, en: load('en'), id: load('id') });
  if (errors.length) {
    console.error(errors.map((e) => `- ${e}`).join('\n'));
    console.error('Add the code to pmo-portal/public/locales/{en,id}/refusals.json.');
    process.exitCode = 1;
  } else console.log(`refusal codes: ${codes.length} raised by migrations, each has an en and an id sentence`);
}
