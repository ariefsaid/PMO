// #2572 — a missing ERP integration-user role (or a missing direct-cost account) is fixed by the
// platform operator, not by the client. The user-facing copy must say the operator will fix it and
// must not hand the client an ERP step.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const load = (lang: 'en' | 'id', file: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(__dirname, `../../../../public/locales/${lang}/${file}.json`), 'utf8'));

const at = (obj: Record<string, unknown>, path: string): string => {
  const v = path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], obj);
  if (typeof v !== 'string') throw new Error(`missing string ${path}`);
  return v;
};

const KEYS: Array<[string, string]> = [
  ['common', 'integrations.organization.readiness.erpActivation.missingReads'],
  ['common', 'integrations.erpSetup.domainFailed'],
  ['administration', 'integrations.send.accountantTask'],
];

describe('#2572 operator-owned ERP setup messages', () => {
  for (const lang of ['en', 'id'] as const) {
    for (const [file, key] of KEYS) {
      it(`${lang}: ${key} says the operator will fix it and gives the client no ERP step`, () => {
        const text = at(load(lang, file), key);
        expect(text).toMatch(/operator/i);
        expect(text).not.toMatch(/grant|berikan|accountant|akuntan|in ERPNext|di ERPNext|ERP read permissions|izin baca ERP/i);
      });
    }
  }
});
