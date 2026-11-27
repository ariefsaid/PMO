/** AC-008 (#3010, FR-016): an organisation's own words for the eight stage terms head both material screens, in both
 *  languages, and reach no other namespace ("received" on a purchase screen stays a purchase word). Binds the shipped
 *  catalogues on disk and the shipped rewriter/plugin. */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import i18next from 'i18next';
import { orgTermsPlugin } from './index';
import { setOrgTerms, shippedTerm, type OrgTerms, type TermKey } from './orgTerms';

const ROOT = resolve(__dirname, '../../../..');
const catalogue = (lang: 'en' | 'id', ns: string) => JSON.parse(readFileSync(resolve(ROOT, `pmo-portal/public/locales/${lang}/${ns}.json`), 'utf8')) as Record<string, unknown>;
async function screen(lang: 'en' | 'id', ns: string) {
  const inst = i18next.createInstance();
  await inst.use(orgTermsPlugin).init({ lng: lang, fallbackLng: 'en', ns: [ns], defaultNS: ns, resources: { en: { [ns]: catalogue('en', ns) }, id: { [ns]: catalogue('id', ns) } } });
  return inst;
}
afterEach(() => setOrgTerms({}));

const HEADINGS: [TermKey, string][] = [
  ['stageRequested', 'col.requested'], ['stageSetAside', 'col.setAside'], ['stageReceived', 'col.received'], ['stageIssued', 'col.issued'],
  ['stageReturned', 'col.returned'], ['stageTransferred', 'col.transferred'], ['stageClosing', 'col.closing'], ['materialReconciliation', 'reconciliation'],
];

describe('AC-008 the eight stage terms', () => {
  for (const lang of ['en', 'id'] as const) {
    it(`ship the words the screens show, and an organisation's word replaces each heading (${lang})`, async () => {
      const om = await screen(lang, 'ownerMaterial');
      for (const [key, path] of HEADINGS) expect(om.t(path).toLowerCase(), key).toBe(shippedTerm(lang, key).singular);
      const own: OrgTerms = { [lang]: Object.fromEntries(HEADINGS.map(([key], i) => [key, { singular: `Kata ${i}`, plural: `Kata ${i}` }])) };
      setOrgTerms(own);
      HEADINGS.forEach(([, path], i) => expect(om.t(path)).toBe(`Kata ${i}`));
    });
  }

  it('a rename stays inside the material screens: a purchase screen word "received" is untouched', async () => {
    setOrgTerms({ en: { stageReceived: { singular: 'Landed', plural: 'Landed' } } });
    const procurement = await screen('en', 'procurement');
    const text = JSON.stringify(catalogue('en', 'procurement'));
    expect(/received/i.test(text)).toBe(true); // the word exists there ...
    expect(JSON.stringify(procurement.t('title', { defaultValue: 'x' }))).not.toContain('Landed');
    for (const key of Object.keys(catalogue('en', 'procurement'))) expect(String(procurement.t(key))).not.toContain('Landed');
  });
});
