import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import i18next from 'i18next';
import { parseRefusal, refusalText } from './refusals';
import en from '../../public/locales/en/refusals.json';
import id from '../../public/locales/id/refusals.json';

const tReal = i18next.t.bind(i18next) as unknown as TFunction;
const ROW_CODES = ['OPN_ROW_INVALID', 'OPN_UNKNOWN_ITEM', 'OPN_UNKNOWN_LOCATION', 'OPN_COST_NEEDED', 'OPN_OVER_ISSUE', 'OPN_DATE_AFTER_GO_LIVE', 'OPN_LOCATION_MOVED', 'OPN_ALREADY_LOADED'];
const ALL = [...ROW_CODES, 'OPN_NOT_ADMIN', 'OPN_TOO_MANY_ROWS'];

describe('opening stock refusals', () => {
  it.each(ALL)('AC-OSH-015 %s has an English and a Bahasa Indonesia sentence', (code) => {
    expect((en as Record<string, string>)[code]?.length).toBeGreaterThan(20);
    expect((id as Record<string, string>)[code]?.length).toBeGreaterThan(20);
  });
  it.each([...ROW_CODES, 'STK_ZERO_COST'])('AC-OSH-015 %s names the row in both languages and says what to do next', (code) => {
    for (const cat of [en, id] as Array<Record<string, string>>) {
      expect(cat[`${code}_figures`]).toContain('{{row}}');
      expect(cat[`${code}_figures`].endsWith('.')).toBe(true);
    }
  });
  it('AC-OSH-015 a refusal that names a row reads its number from the database text', () => {
    expect(parseRefusal({ message: 'OPN_OVER_ISSUE: row 7' })?.values).toEqual({ row: '7' });
    expect(parseRefusal({ message: 'STK_ZERO_COST: row 3' })?.values).toEqual({ row: '3' });
  });
  it('AC-OSH-015 the screen shows the row sentence when a row is named, and the plain sentence for the table cell', () => {
    expect(refusalText({ message: 'OPN_OVER_ISSUE: row 7' }, tReal).headline).toMatch(/^Row 7: this out row is larger/);
    expect(refusalText({ message: 'OPN_OVER_ISSUE: ' }, tReal).headline).toMatch(/^This out row is larger/);
  });
});
