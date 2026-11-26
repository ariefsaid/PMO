/** AC-TR-002 / AC-TR-003 / AC-TR-004 (#2799): the registry is the one list; TERM_KEYS, the database seed and the rewriter agree with it. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import registry from './terms.registry.json' with { type: 'json' };
import { applyOrgTerms, SHIPPED_FORMS, shippedTerm, TERM_KEYS, TERM_REGISTRY, TERM_SCOPE, type OrgTerms } from './orgTerms';

const ROOT = resolve(__dirname, '../../../..');
const keysOf = (sql: string) => [...sql.matchAll(/\('([A-Za-z]+)'\)/g)].map((m) => m[1]);

describe('AC-TR-002 the registry and TERM_KEYS are one list', () => {
  it('TERM_KEYS equals the registry keys in order', () => {
    expect([...TERM_KEYS]).toEqual(registry.terms.map((t) => t.key));
    expect(TERM_REGISTRY).toHaveLength(TERM_KEYS.length);
  });
  it('every key has a shipped form in both languages, singular and plural, and no key repeats', () => {
    expect(new Set(TERM_KEYS).size).toBe(TERM_KEYS.length);
    for (const key of TERM_KEYS) for (const loc of ['en', 'id'] as const) {
      expect(SHIPPED_FORMS[loc][key].singular.length, `${key} ${loc} singular`).toBeGreaterThan(0);
      expect(SHIPPED_FORMS[loc][key].plural.length, `${key} ${loc} plural`).toBeGreaterThan(0);
    }
  });
  it('a variant spelling is never also a shipped form', () => {
    for (const term of registry.terms) for (const loc of ['en', 'id'] as const) {
      const shipped = new Set([...term[loc].singular, ...term[loc].plural].map((f) => f.toLowerCase()));
      for (const v of term.variants?.[loc] ?? []) expect(shipped.has(v.toLowerCase()), `${term.key} ${loc} ${v}`).toBe(false);
    }
  });
});

describe('AC-TR-003 the database seed carries the registry keys', () => {
  it('the migrations insert exactly the registry keys', () => {
    const a = keysOf(readFileSync(resolve(ROOT, 'supabase/migrations/1491_org_term_keys_registry.sql'), 'utf8').split('insert into')[1].split(';')[0]);
    const b = keysOf(readFileSync(resolve(ROOT, 'supabase/migrations/1903_org_term_keys_reach.sql'), 'utf8').split('insert into')[1].split(';')[0]);
    const c = keysOf(readFileSync(resolve(ROOT, 'supabase/migrations/2777_additional_term_keys.sql'), 'utf8').split('insert into')[1].split(';')[0]);
    expect([...a, ...b, ...c].sort()).toEqual([...TERM_KEYS].sort());
  });
});

describe('AC-TR-004 the aligned and new forms rename', () => {
  const en = (key: string, s: string, p = s): OrgTerms => ({ en: { [key]: { singular: s, plural: p } } });
  const id = (key: string, s: string): OrgTerms => ({ id: { [key]: { singular: s, plural: s } } });
  it('the default shown for clientSuppliedStock is the wording the screens use', () => {
    expect(shippedTerm('en', 'clientSuppliedStock').singular).toBe('client-supplied item');
    expect(applyOrgTerms('The code of a client-supplied item.', 'en', en('clientSuppliedStock', 'free-issue item'))).toBe('The code of a free-issue item.');
    expect(applyOrgTerms('Item ini bukan material pasokan klien.', 'id', id('clientSuppliedStock', 'barang titipan'))).toBe('Item ini bukan barang titipan.');
  });
  it('English site cash is the imprest default, and the long Bahasa work-order form renames', () => {
    expect(shippedTerm('en', 'imprest').singular).toBe('site cash');
    expect(applyOrgTerms('Record site cash', 'en', en('imprest', 'petty cash'))).toBe('Record petty cash');
    expect(applyOrgTerms('Perintah kerja ini sudah ditutup', 'id', id('workOrder', 'pekerjaan'))).toBe('Pekerjaan ini sudah ditutup');
  });
  it('new terms rewrite in both languages, plural before singular', () => {
    expect(applyOrgTerms('2 billing steps', 'en', en('billingStep', 'stage', 'stages'))).toBe('2 stages');
    expect(applyOrgTerms('Rencana penagihan', 'id', id('billingPlan', 'jadwal tagih'))).toBe('Jadwal tagih');
    expect(applyOrgTerms('Transfer between work orders', 'en', en('workOrderTransfer', 'job swap'))).toBe('Job swap');
  });
  it('a transfer between work orders still follows a renamed work order when the transfer itself is not renamed', () => {
    expect(applyOrgTerms('Transfer between work orders', 'en', en('workOrder', 'job', 'jobs'))).toBe('Transfer between jobs');
  });
  it('the common-word terms are scoped: "issue" is a verb outside its namespaces', () => {
    expect(TERM_SCOPE.issue).toBeDefined();
    const terms = en('issue', 'concern', 'concerns');
    expect(applyOrgTerms('Issue an order', 'en', terms, { namespace: 'procurement' })).toBe('Issue an order');
    expect(applyOrgTerms('Issue an order', 'en', terms)).toBe('Issue an order');
    expect(applyOrgTerms('This issue is overdue', 'en', terms, { namespace: 'incidents' })).toBe('This concern is overdue');
  });
});
