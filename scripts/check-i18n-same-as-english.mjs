#!/usr/bin/env node
/**
 * FR-L10N-042c — the same-as-English gate (id side).
 *
 * `check-i18n-completeness.mjs --id` proves every launch-scope key is PRESENT in `id` and not
 * empty. Presence is not translation: a value copied verbatim from English passes that gate and
 * still renders English to an Indonesian reader — invisible at runtime, exactly like a missing key,
 * because i18next has nothing to fall back FROM.
 *
 * This gate fails when an `id` value is byte-identical to its `en` value and is English prose.
 * Three exemptions, each with a REASON on the allowlist (`i18n-same-as-english-allowlist.json`):
 *
 *   namespace — a whole namespace stays English by ruling (the legal texts, Director 2026-11-13).
 *   value     — a term Indonesian uses as written: a brand or product name, a tax article name
 *               ("PPh 23"), a trade term ("Bill of quantities"), a loanword ("Status", "Total"),
 *               an acronym ("RFQ"), or a string whose words are all placeholders.
 *
 * ⚑ A placeholder-only value is exempt STRUCTURALLY, not by allowlist entry: `{{name}}`,
 * `{{pct}}%`, `{{hours}} {{unit}}` carry no prose to translate, and listing each one would make the
 * allowlist a transcript of the catalogue instead of a record of decisions. Placeholders and
 * `<n>` component slots are stripped before the prose test.
 *
 * STALE ENTRIES FAIL. An allowlist entry whose namespace/value no longer appears in the catalogue
 * is dead weight: it hides the next regression behind a permission nobody re-read. The self-test
 * plants that case, plus the defect itself, so the gate is gated like every other gate here
 * (`check-i18n-completeness.mjs`, `check-i18n-namespaces.mjs`).
 *
 * Usage:
 *   node scripts/check-i18n-same-as-english.mjs
 *   node scripts/check-i18n-same-as-english.mjs --self-test
 *
 * ⚑ It runs as the last two steps of `npm run check:i18n` (Director ruling 2026-11-13), so it gates
 * wherever check:i18n gates — `check:guards`, `verify` and CI's verify job — with no ci.yml edit. It
 * is deliberately NOT a top-level `check:*` npm script: the repository gate
 * (`scripts/ci-integration-order.test.mjs`) requires every such script to be invoked by
 * `check:guards`, and a second entry point would only duplicate the run.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const LOCALES = path.join(ROOT, 'pmo-portal/public/locales');
const ALLOWLIST = path.join(HERE, 'i18n-same-as-english-allowlist.json');

/** `{a: {b: 'x'}}` → `Map('a.b' → 'x')`; leaves (including arrays and null) are values. */
export function flattenCatalogue(node, prefix = '', out = new Map()) {
  for (const [key, value] of Object.entries(node ?? {})) {
    const dotted = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      flattenCatalogue(value, dotted, out);
    } else {
      out.set(dotted, value);
    }
  }
  return out;
}

/**
 * What is left of a message once the machinery is removed: `{{placeholders}}`, `<0>` component
 * slots and HTML entities. A string with no prose left cannot be untranslated English.
 */
export function proseOf(value) {
  return String(value)
    .replace(/\{\{[^{}]*\}\}/g, ' ')
    .replace(/<\/?\d+>/g, ' ')
    .replace(/&[a-zA-Z]+;/g, ' ')
    .trim();
}

const hasProse = (value) => /[A-Za-z]{2}/.test(proseOf(value));

/**
 * The whole check over in-memory catalogues, so the self-test exercises THIS function rather than
 * a re-implementation of it (the `check-edge-fn-test-binding` rule applied to a gate).
 *
 * @param {{en: Record<string, object>, id: Record<string, object>, allowlist: {namespaces?: Array<{namespace: string, reason: string}>, values?: Array<{value: string, reason: string}>}}} input
 */
export function findSameAsEnglish({ en, id, allowlist = {} }) {
  const namespaceEntries = allowlist.namespaces ?? [];
  const valueEntries = allowlist.values ?? [];
  const allowedNamespaces = new Set(namespaceEntries.map((entry) => entry.namespace));
  const allowedValues = new Set(valueEntries.map((entry) => entry.value));
  const findings = [];
  const errors = [];
  const identicalProse = new Set();

  for (const namespace of Object.keys(en).sort()) {
    const enKeys = flattenCatalogue(en[namespace]);
    const idKeys = flattenCatalogue(id[namespace]);
    for (const [key, enValue] of enKeys) {
      if (typeof enValue !== 'string') continue;
      if (!idKeys.has(key)) continue; // absence is the completeness gate's finding
      const idValue = idKeys.get(key);
      if (typeof idValue !== 'string' || idValue !== enValue) continue;
      if (!hasProse(enValue)) continue; // placeholders, symbols, single letters
      identicalProse.add(enValue);
      if (allowedNamespaces.has(namespace) || allowedValues.has(enValue)) continue;
      findings.push({ namespace, key, value: enValue });
    }
  }

  for (const entry of namespaceEntries) {
    if (!String(entry.reason ?? '').trim()) {
      errors.push({ kind: 'missing-reason', entry: `namespace:${entry.namespace}` });
    }
    if (!Object.hasOwn(en, entry.namespace)) {
      errors.push({ kind: 'stale-namespace', entry: `namespace:${entry.namespace}` });
    }
  }
  for (const entry of valueEntries) {
    if (!String(entry.reason ?? '').trim()) {
      errors.push({ kind: 'missing-reason', entry: `value:${entry.value}` });
    }
    if (!identicalProse.has(entry.value)) {
      errors.push({ kind: 'stale-value', entry: `value:${entry.value}` });
    }
  }

  return { findings, errors };
}

function loadLocale(locale) {
  const dir = path.join(LOCALES, locale);
  return Object.fromEntries(
    fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => [path.basename(name, '.json'), JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))]),
  );
}

const fixture = (enValue, idValue = enValue) => ({
  en: { common: { key: enValue } },
  id: { common: { key: idValue } },
});

function runSelfTest() {
  const clean = fixture('Save', 'Simpan');
  const allowlist = { namespaces: [], values: [] };
  if (findSameAsEnglish({ ...clean, allowlist }).findings.length) {
    throw new Error('clean self-test fixture was rejected');
  }

  // 1. The defect itself: a copied English value in id.
  const planted = findSameAsEnglish({ ...fixture('Save the draft'), allowlist });
  if (!planted.findings.some((finding) => finding.key === 'key' && finding.value === 'Save the draft')) {
    throw new Error('an identical en/id value was not refused');
  }

  // 2. A single English word is prose too — the Director's script skips these, this gate must not.
  if (!findSameAsEnglish({ ...fixture('Edit'), allowlist }).findings.length) {
    throw new Error('an identical single English word was not refused');
  }

  // 3. Placeholder-only values are exempt structurally.
  for (const value of ['{{name}}', '{{pct}}%', '{{hours}} {{unit}}', '—', '+', 'A']) {
    if (findSameAsEnglish({ ...fixture(value), allowlist }).findings.length) {
      throw new Error(`a placeholder-only value was refused: ${value}`);
    }
  }

  // 4. An allowlisted term passes; a stale entry fails.
  const termAllowlist = { namespaces: [], values: [{ value: 'Status', reason: 'an Indonesian word (KBBI)' }] };
  if (findSameAsEnglish({ ...fixture('Status'), allowlist: termAllowlist }).findings.length) {
    throw new Error('an allowlisted term was refused');
  }
  const stale = findSameAsEnglish({ ...fixture('Simpan', 'Simpan'), allowlist: termAllowlist });
  if (!stale.errors.some((error) => error.kind === 'stale-value')) {
    throw new Error('a stale allowlist entry was not detected');
  }

  // 5. A whole namespace by ruling; a stale namespace fails.
  const namespaceAllowlist = { namespaces: [{ namespace: 'legal', reason: 'legal text stays English' }], values: [] };
  const legalFixture = { en: { legal: { title: 'Terms of Service' } }, id: { legal: { title: 'Terms of Service' } } };
  if (findSameAsEnglish({ ...legalFixture, allowlist: namespaceAllowlist }).findings.length) {
    throw new Error('an allowlisted namespace was refused');
  }
  const staleNamespace = findSameAsEnglish({ ...fixture('Save', 'Simpan'), allowlist: namespaceAllowlist });
  if (!staleNamespace.errors.some((error) => error.kind === 'stale-namespace')) {
    throw new Error('a stale namespace entry was not detected');
  }

  // 6. An entry with no reason is refused: an exemption must stay reviewable.
  const noReason = { namespaces: [], values: [{ value: 'Status', reason: '  ' }] };
  if (!findSameAsEnglish({ ...fixture('Status'), allowlist: noReason }).errors.some((error) => error.kind === 'missing-reason')) {
    throw new Error('an allowlist entry without a reason was not detected');
  }

  console.log('i18n same-as-English guard self-test passed');
}

if (process.argv.includes('--self-test')) {
  runSelfTest();
} else {
  const allowlist = JSON.parse(fs.readFileSync(ALLOWLIST, 'utf8'));
  const { findings, errors } = findSameAsEnglish({ en: loadLocale('en'), id: loadLocale('id'), allowlist });
  const lines = [
    ...findings.map(
      (finding) => `- ${finding.namespace}:${finding.key} is identical in en and id (${JSON.stringify(finding.value)}): translate it, or allowlist the term with a reason`,
    ),
    ...errors.map((error) => `- ${error.kind}: ${error.entry}`),
  ];
  if (lines.length) {
    console.error(lines.join('\n'));
    process.exitCode = 1;
  } else {
    console.log('i18n same-as-English guard passed: no untranslated English prose in id');
  }
}
