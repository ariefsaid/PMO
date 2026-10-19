#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCALES = path.join(ROOT, 'pmo-portal/public/locales');
const BASELINE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'i18n-common-keys-baseline.json');
const ALLOWLIST = path.join(path.dirname(fileURLToPath(import.meta.url)), 'i18n-common-key-allowlist.json');

function keys(value, prefix = '', result = []) {
  for (const [key, child] of Object.entries(value)) {
    const current = prefix ? `${prefix}.${key}` : key;
    if (child !== null && typeof child === 'object' && !Array.isArray(child)) keys(child, current, result);
    else result.push(current);
  }
  return result.sort();
}

export function checkCatalogues({ en, id, baseline, allowlist }) {
  const errors = [];
  for (const namespace of new Set([...Object.keys(en), ...Object.keys(id)])) {
    if (!en[namespace] || !id[namespace]) {
      errors.push(`namespace ${namespace} must exist in both en and id`);
      continue;
    }
    const enKeys = keys(en[namespace]);
    const idKeys = keys(id[namespace]);
    if (JSON.stringify(enKeys) !== JSON.stringify(idKeys)) errors.push(`${namespace}: EN/ID key parity differs`);
  }
  const oldKeys = new Set(baseline);
  const permitted = new Set(allowlist);
  const added = keys(en.common ?? {}).filter((key) => !oldKeys.has(key));
  for (const key of added) if (!permitted.has(key)) errors.push(`new common key must use a feature namespace: ${key}`);
  for (const key of permitted) if (!added.includes(key)) errors.push(`stale common-key allowlist entry: ${key}`);
  return errors;
}

function loadLocale(locale) {
  const dir = path.join(LOCALES, locale);
  return Object.fromEntries(fs.readdirSync(dir).filter((name) => name.endsWith('.json')).map((name) => [path.basename(name, '.json'), JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))]));
}

function runSelfTest() {
  const clean = { en: { common: { old: 'old' }, feature: { title: 'Title' } }, id: { common: { old: 'lama' }, feature: { title: 'Judul' } } };
  const base = ['old'];
  if (checkCatalogues({ ...clean, baseline: base, allowlist: [] }).length) throw new Error('clean self-test fixture was rejected');
  if (!checkCatalogues({ ...clean, en: { ...clean.en, feature: { title: 'Title', extra: 'Extra' } }, baseline: base, allowlist: [] }).some((error) => error.includes('parity'))) throw new Error('namespace parity defect was not detected');
  if (!checkCatalogues({ ...clean, id: { common: clean.id.common }, baseline: base, allowlist: [] }).some((error) => error.includes('must exist in both'))) throw new Error('namespace missing from one locale was not detected');
  if (!checkCatalogues({ ...clean, en: { ...clean.en, common: { old: 'old', added: 'New' } }, baseline: base, allowlist: [] }).some((error) => error.includes('new common key'))) throw new Error('common-key policy defect was not detected');
  if (checkCatalogues({ ...clean, en: { ...clean.en, common: { old: 'old', added: 'New' } }, id: { ...clean.id, common: { old: 'lama', added: 'Baru' } }, baseline: base, allowlist: ['added'] }).length) throw new Error('allowlisted common key was rejected');
  if (!checkCatalogues({ ...clean, baseline: base, allowlist: ['not-added'] }).some((error) => error.includes('stale common-key allowlist'))) throw new Error('stale common-key allowlist was not detected');
  console.log('i18n namespace guard self-test passed');
}

if (process.argv.includes('--self-test')) runSelfTest();
else {
  const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  const allowlist = JSON.parse(fs.readFileSync(ALLOWLIST, 'utf8'));
  const errors = checkCatalogues({ en: loadLocale('en'), id: loadLocale('id'), baseline, allowlist });
  if (errors.length) {
    console.error(errors.map((error) => `- ${error}`).join('\n'));
    process.exitCode = 1;
  } else console.log('i18n namespace parity and common-key policy passed');
}
