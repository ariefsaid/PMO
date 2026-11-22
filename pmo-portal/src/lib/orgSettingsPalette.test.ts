import { describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import en from '@/public/locales/en/common.json';
import id from '@/public/locales/id/common.json';
import { ORG_SETTINGS, orgSettingKeys } from './orgSettingsCatalogue';
import { buildSettingsPaletteItems } from './orgSettingsPalette';

/** #2746 AC-OSM-034: ⌘K finds a setting by its name in English or Bahasa and opens where it is changed. */
const instance = i18next.createInstance();
await instance.init({ lng: 'id', fallbackLng: 'en', ns: ['common'], defaultNS: 'common', resources: { en: { common: en }, id: { common: id } } });
const tEn = instance.getFixedT('en');
const tId = instance.getFixedT('id');

describe('buildSettingsPaletteItems (AC-OSM-034)', () => {
  it('gives an Admin one entry per setting plus All settings, each opening its route', () => {
    const navigate = vi.fn();
    const items = buildSettingsPaletteItems(tEn, instance, 'Admin', navigate);
    expect(items).toHaveLength(orgSettingKeys.length + 1);
    items.find((i) => i.id === 'setting-crewLoans')!.run();
    expect(navigate).toHaveBeenCalledWith(ORG_SETTINGS.crewLoans.route);
    items.find((i) => i.id === 'setting-all')!.run();
    expect(navigate).toHaveBeenCalledWith('/administration/all-settings');
  });

  it('matches by the English name and by the Bahasa name whichever language the interface is in', () => {
    const inEnglish = buildSettingsPaletteItems(tEn, instance, 'Admin', vi.fn()).find((i) => i.id === 'setting-crewLoans')!;
    expect(inEnglish.title).toBe('Crew loans');
    expect(inEnglish.searchCodes).toEqual(['Crew loans', 'Pinjaman kru']);
    const inBahasa = buildSettingsPaletteItems(tId, instance, 'Admin', vi.fn()).find((i) => i.id === 'setting-crewLoans')!;
    expect(inBahasa.title).toBe('Pinjaman kru');
    expect(inBahasa.searchCodes).toEqual(['Crew loans', 'Pinjaman kru']);
  });

  it('offers a role only the settings it may change, and nothing to a role that may change none', () => {
    const labour = buildSettingsPaletteItems(tEn, instance, 'Finance', vi.fn()).map((i) => i.id);
    expect(labour).toContain('setting-labourCost');
    expect(labour).not.toContain('setting-crewLoans');
    expect(labour).not.toContain('setting-all');
    expect(buildSettingsPaletteItems(tEn, instance, 'Engineer', vi.fn())).toEqual([]);
    expect(buildSettingsPaletteItems(tEn, instance, undefined, vi.fn())).toEqual([]);
  });
});
