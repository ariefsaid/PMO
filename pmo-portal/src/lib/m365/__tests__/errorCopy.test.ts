import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import i18next from 'i18next';
import en from '../../../../public/locales/en/common.json';
import id from '../../../../public/locales/id/common.json';
import { parseMissingKeyHandler as appMissingKeyHandler } from '@/src/lib/i18n';
import { M365_ERROR_CODES, knownM365ErrorReason, m365ErrorReason } from '../errorCopy';

/**
 * AC-M365LOC-006 (#690) — ONE code→copy table shared by the personal card and the organization
 * approval card. A wire code the edge fn can emit must never reach a user as the generic fallback
 * (or as a raw key) just because nobody added its copy.
 */

/** The wire taxonomy, read from the edge fn's source of truth so a NEW server code fails here. */
function wireCodes(): string[] {
  const src = readFileSync(
    resolve(process.cwd(), '../supabase/functions/m365-token-custody/types.ts'),
    'utf8',
  );
  const block = /export const ERROR_STATUS[^{]*\{([^}]*)\}/.exec(src)?.[1] ?? '';
  return [...block.matchAll(/^\s*([A-Z_]+)\s*:/gm)].map((m) => m[1]);
}

async function makeT(lng: 'en' | 'id', withCatalogue: boolean) {
  const missing: string[] = [];
  const inst = i18next.createInstance();
  await inst.init({
    lng,
    fallbackLng: false,
    resources: withCatalogue ? { en: { translation: en }, id: { translation: id } } : {},
    interpolation: { escapeValue: false },
    // The app's real last-resort handler (English source default, else the key) — wrapped only to
    // record which keys no catalogue could resolve.
    parseMissingKeyHandler: (key: string, defaultValue?: string) => {
      missing.push(key);
      return appMissingKeyHandler(key, defaultValue);
    },
  });
  return { t: inst.t.bind(inst), missing };
}

describe('AC-M365LOC-006: shared M365 error copy', () => {
  it('AC-M365LOC-006: the table covers exactly the wire codes the edge function emits', () => {
    const wire = wireCodes();
    expect(wire.length).toBe(15);
    expect([...M365_ERROR_CODES].sort()).toEqual([...wire].sort());
  });

  it.each(['en', 'id'] as const)(
    'AC-M365LOC-006: every known code has localized %s copy (no missing key, no raw code)',
    async (lng) => {
      const { t, missing } = await makeT(lng, true);
      for (const code of wireCodes()) {
        const reason = knownM365ErrorReason(t, code);
        expect(reason, `${code} has no reason`).toEqual(expect.any(String));
        expect(reason, `${code} rendered a raw key`).not.toMatch(/^integrations\./);
        expect(reason, `${code} leaked its code`).not.toContain(code);
      }
      expect(missing).toEqual([]);
    },
  );

  it('AC-M365LOC-006: a known code with an EMPTY catalogue still reads as reviewed English (never a key)', async () => {
    const { t } = await makeT('en', false);
    for (const code of wireCodes()) {
      const reason = knownM365ErrorReason(t, code);
      expect(reason, code).toEqual(expect.any(String));
      expect(reason, code).not.toMatch(/^integrations\./);
    }
  });

  it('AC-M365LOC-006: an unknown or absent code has no reason; m365ErrorReason falls back to the caller text', async () => {
    const { t } = await makeT('en', true);
    expect(knownM365ErrorReason(t, 'SOMETHING_NEW')).toBeNull();
    expect(knownM365ErrorReason(t, undefined)).toBeNull();
    expect(m365ErrorReason(t, 'SOMETHING_NEW', 'fallback text')).toBe('fallback text');
    expect(m365ErrorReason(t, 'NOT_ENTITLED', 'fallback text')).toBe(
      en.integrations.personalM365.errors.notEntitled,
    );
  });

  it('AC-M365LOC-007: insufficient-permission copy names the Connect action, never Reconnect', async () => {
    const en_ = (await makeT('en', true)).t;
    const id_ = (await makeT('id', true)).t;
    expect(knownM365ErrorReason(en_, 'SCOPE_INSUFFICIENT')).toMatch(/Connect again/);
    expect(knownM365ErrorReason(en_, 'SCOPE_INSUFFICIENT')).not.toMatch(/reconnect/i);
    expect(knownM365ErrorReason(id_, 'SCOPE_INSUFFICIENT')).toMatch(/Hubungkan kembali/);
    expect(knownM365ErrorReason(id_, 'SCOPE_INSUFFICIENT')).not.toMatch(/hubungkan ulang/i);
  });
});
