/**
 * Every reservation refusal reads as a sentence in both languages, through the app's REAL i18n options (a missing
 * key answers with its own name there, so a stub `t` cannot see a raw code on screen: the earlier fix passed on a stub).
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import i18next from 'i18next';
import { describe, expect, it } from 'vitest';
import enRefusals from '@/public/locales/en/refusals.json';
import idRefusals from '@/public/locales/id/refusals.json';
import enCommon from '@/public/locales/en/common.json';
import idCommon from '@/public/locales/id/common.json';
import { i18nInitOptions } from '@/src/lib/i18n';
import { refusalText } from './refusals';

const MIGRATIONS = path.resolve(__dirname, '../../../supabase/migrations');
const raised = (family: string): string[] => {
  const codes = new Set<string>();
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql'))) {
    for (const m of readFileSync(path.join(MIGRATIONS, f), 'utf8').matchAll(new RegExp(`'(${family}_[A-Z0-9_]+): `, 'g'))) codes.add(m[1]);
  }
  return [...codes].sort();
};

async function appT(lng: 'en' | 'id') {
  const inst = i18next.createInstance();
  await inst.init({
    ...i18nInitOptions(lng, inst),
    resources: { en: { common: enCommon, refusals: enRefusals }, id: { common: idCommon, refusals: idRefusals } },
  });
  return inst.t.bind(inst);
}

describe('reservation refusals (RSV_*)', () => {
  const codes = raised('RSV');

  it('finds the reservation codes the migrations raise', () => {
    expect(codes).toEqual(expect.arrayContaining(['RSV_EXCEEDS_FREE', 'RSV_EXCEEDS_REMAINING', 'RSV_OVERDRAW', 'RSV_FORBIDDEN']));
  });

  it.each(['en', 'id'] as const)('every code has a sentence in %s that is not a code or a key', async (lng) => {
    const t = await appT(lng);
    for (const code of codes) {
      const { headline, detail, known } = refusalText({ message: `${code}: Only 40 is free here` }, t as never);
      expect(known, code).toBe(true);
      expect(headline, code).not.toMatch(/RSV_|refusals:|_figures/);
      expect(headline.trim(), code).not.toBe('');
      expect(detail, code).not.toMatch(/RSV_|refusals:|_detail/);
    }
  });

  it('the over-free refusal names the free quantity', async () => {
    expect(refusalText({ message: 'RSV_EXCEEDS_FREE: Only 40 is free at this location' }, (await appT('en')) as never).headline).toBe('Only 40 is free at this location.');
    expect(refusalText({ message: 'RSV_EXCEEDS_FREE: Only 40 is free at this location' }, (await appT('id')) as never).headline).toBe('Hanya 40 yang bebas di lokasi ini.');
  });
});
