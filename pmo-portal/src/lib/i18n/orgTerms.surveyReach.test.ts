/** #2799 slice B3 (survey-cap-record joined the combined base): the billing survey screen names the
 *  quantity as "Surveyed quantity" / "Kuantitas disurvei". An organisation that renames
 *  surveyQuantity must see its word in those field labels and in the prose that names the same
 *  quantity, so the registry ships the named phrases beside the pre-seeded default. These tests bind
 *  the real registry, the shipped rewriter/plugin and the real en/id survey catalogue, and pin the
 *  boundaries this slice must not cross: the survey date and the bare "surveyed"/"disurvei" verb stay,
 *  and quality-ready, certified and accepted quantities are never reclassified. */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import i18next from 'i18next';
import { orgTermsPlugin } from './index';
import { applyOrgTerms, setOrgTerms, SHIPPED_FORMS, shippedTerm, type OrgTerms } from './orgTerms';

const ROOT = resolve(__dirname, '../../../..');

/** A shipped catalogue exactly as the guard reads it (public/locales/<lang>/<ns>.json). */
function catalogue(lang: 'en' | 'id', ns: string): Record<string, string | object> {
  return JSON.parse(readFileSync(resolve(ROOT, `pmo-portal/public/locales/${lang}/${ns}.json`), 'utf8')) as Record<string, string | object>;
}

/** An i18next instance over the real catalogue, with the same terminology plugin the app installs. */
async function screen(lang: 'en' | 'id', ns: string) {
  const inst = i18next.createInstance();
  await inst.use(orgTermsPlugin).init({
    lng: lang,
    fallbackLng: 'en',
    ns: [ns],
    defaultNS: ns,
    resources: { en: { [ns]: catalogue('en', ns) }, id: { [ns]: catalogue('id', ns) } },
  });
  return inst;
}

/** Every leaf string of a catalogue, so a test can prove how much of one screen a rename reaches. */
function leaves(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') out.push(node);
  else if (node && typeof node === 'object') for (const value of Object.values(node)) leaves(value, out);
  return out;
}

const renamed = (locale: 'en' | 'id'): OrgTerms =>
  locale === 'en'
    ? { en: { surveyQuantity: { singular: 'measured quantity', plural: 'measured quantities' } } }
    : { id: { surveyQuantity: { singular: 'volume terukur', plural: 'volume terukur' } } };

afterEach(() => setOrgTerms({}));

describe('the registry ships the quantity word the survey screens use', () => {
  it('keeps the pre-seeded default first and adds the named quantity after it', () => {
    expect(shippedTerm('en', 'surveyQuantity')).toEqual({ singular: 'survey quantity', plural: 'survey quantities' });
    expect(shippedTerm('id', 'surveyQuantity')).toEqual({ singular: 'kuantitas survei', plural: 'kuantitas survei' });
    expect(SHIPPED_FORMS.en.surveyQuantity.singular).toContain('surveyed quantity');
    expect(SHIPPED_FORMS.en.surveyQuantity.plural).toContain('surveyed quantities');
    expect(SHIPPED_FORMS.id.surveyQuantity.singular).toContain('kuantitas disurvei');
    expect(SHIPPED_FORMS.id.surveyQuantity.plural).toContain('kuantitas disurvei');
  });

  it('the real survey catalogue carries that form in both languages, so the R2 excuse is resolved', () => {
    const shipped = (locale: 'en' | 'id') =>
      new Set([...SHIPPED_FORMS[locale].surveyQuantity.singular, ...SHIPPED_FORMS[locale].surveyQuantity.plural].map((form) => form.toLowerCase()));
    for (const locale of ['en', 'id'] as const) {
      const values = leaves(catalogue(locale, 'survey')).map((value) => value.toLowerCase());
      expect(values.some((value) => shipped(locale).has(value)), locale).toBe(true);
    }
  });
});

describe('a renamed survey quantity reaches the field labels in both languages', () => {
  it('English: both labels show the organisation word and keep the unit placeholder', async () => {
    const survey = await screen('en', 'survey');
    setOrgTerms(renamed('en'));
    expect(survey.t('form.surveyedNoUnit')).toBe('Measured quantity');
    expect(survey.t('form.surveyed', { unit: 'm2' })).toBe('Measured quantity (m2)');
    expect(survey.t('form.surveyed', { unit: 'm3' })).toBe('Measured quantity (m3)');
  });

  it('Bahasa: both labels show the organisation word and keep the unit placeholder', async () => {
    const survey = await screen('id', 'survey');
    setOrgTerms(renamed('id'));
    expect(survey.t('form.surveyedNoUnit')).toBe('Volume terukur');
    expect(survey.t('form.surveyed', { unit: 'm2' })).toBe('Volume terukur (m2)');
  });

  it('rewrites the template before interpolation, so {{unit}} is never touched', () => {
    expect(applyOrgTerms('Surveyed quantity ({{unit}})', 'en', renamed('en'))).toBe('Measured quantity ({{unit}})');
    expect(applyOrgTerms('Kuantitas disurvei ({{unit}})', 'id', renamed('id'))).toBe('Volume terukur ({{unit}})');
  });
});

describe('the same rename reaches the quantity named in prose, not only the label', () => {
  it('rewrites the survey helper, the claim-ceiling refusal and the administration helper', async () => {
    const survey = await screen('en', 'survey');
    const refusals = await screen('en', 'refusals');
    const admin = await screen('en', 'administration');
    setOrgTerms(renamed('en'));
    expect(survey.t('form.qualityHelp')).toBe('The part of the measured quantity that has quality documents. Attach them below.');
    expect(refusals.t('SVY_QUALITY_OVER')).toBe('The quality-ready quantity cannot be more than the measured quantity.');
    expect(refusals.t('SVY_QUALITY_OVER_detail')).toBe('Lower the quality-ready quantity, or raise the measured quantity.');
    expect(admin.t('admin.claimOverCap.helper')).toContain('the measured quantity when there is one');
  });

  it('reaches many of the survey screen strings, not one token', () => {
    const changed = (locale: 'en' | 'id') =>
      leaves(catalogue(locale, 'survey')).filter((value) => applyOrgTerms(value, locale, renamed(locale)) !== value).length;
    expect(changed('en')).toBeGreaterThanOrEqual(4);
    expect(changed('id')).toBeGreaterThanOrEqual(3);
  });
});

describe('the rename leaves the neighbouring meanings alone', () => {
  it('does not rewrite the survey date or the bare surveyed/disurvei verb', async () => {
    const en = await screen('en', 'survey');
    const id = await screen('id', 'survey');
    setOrgTerms({ ...renamed('en'), ...renamed('id') });
    expect(en.t('on', { date: '2026-11-22' })).toBe('Surveyed on 2026-11-22');
    expect(id.t('on', { date: '2026-11-22' })).toBe('Disurvei pada 2026-11-22');
    expect(en.t('row', { line: 'L1', surveyed: '5', unit: 'm2', quality: '4' })).toBe('L1: surveyed 5 m2, quality-ready 4 m2');
    expect(id.t('row', { line: 'L1', surveyed: '5', unit: 'm2', quality: '4' })).toBe('L1: disurvei 5 m2, siap mutu 4 m2');
    // Bahasa names the surveyed amount with the bare verb in this comparison, never with the quantity noun.
    expect(id.t('form.errors.qualityOver')).toBe('Jumlah siap mutu tidak boleh lebih besar dari jumlah yang disurvei');
  });

  it('does not reclassify quality-ready, certified or accepted quantities', async () => {
    const survey = await screen('en', 'survey');
    setOrgTerms(renamed('en'));
    expect(survey.t('form.quality')).toBe('Quality-ready quantity');
    expect(survey.t('certifiedHeading')).toBe('Certified per line');
    expect(survey.t('certifiedLine', { line: 'L1', certified: '5', unit: 'm2', quality: '4' })).toBe('L1: certified 5 m2, quality-ready 4 m2');
    expect(survey.t('confirmBody', { surveyed: '5', unit: 'm2', line: 'L1' })).toBe(
      'Confirming adds 5 m2 to the certified quantity of L1. A confirmed survey cannot be edited; a mistake is fixed by recording a correction.',
    );
    expect(applyOrgTerms('Each accepted quantity must be 0 or more', 'en', renamed('en'))).toBe('Each accepted quantity must be 0 or more');
    expect(applyOrgTerms('Kuantitas tersertifikasi dan kuantitas siap mutu', 'id', renamed('id'))).toBe('Kuantitas tersertifikasi dan kuantitas siap mutu');
  });
});
