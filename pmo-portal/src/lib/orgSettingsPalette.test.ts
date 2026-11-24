import { describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import en from '@/public/locales/en/common.json';
import id from '@/public/locales/id/common.json';
import billingStepsEn from '@/public/locales/en/billingSteps.json';
import billingStepsId from '@/public/locales/id/billingSteps.json';
import siteReportEn from '@/public/locales/en/siteReport.json';
import siteReportId from '@/public/locales/id/siteReport.json';
import { ORG_SETTINGS, orgSettingKeys } from './orgSettingsCatalogue';
import { buildSettingsPaletteItems } from './orgSettingsPalette';

/** #2746 AC-OSM-034: ⌘K finds a setting by its name in English or Bahasa and opens where it is changed. */
const instance = i18next.createInstance();
await instance.init({ lng: 'id', fallbackLng: 'en', ns: ['common', 'billingSteps', 'siteReport'], defaultNS: 'common', resources: { en: { common: en, billingSteps: billingStepsEn, siteReport: siteReportEn }, id: { common: id, billingSteps: billingStepsId, siteReport: siteReportId } } });
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

  it('AC-OSM-034 finds checklist settings by name in either language', () => {
    const inEnglish = buildSettingsPaletteItems(tEn, instance, 'Admin', vi.fn()).find((i) => i.id === 'setting-workOrderChecklist')!;
    expect(inEnglish.title).toBe('Work-order checklist editing');
    expect(inEnglish.searchCodes).toEqual(['Work-order checklist editing', 'Pengeditan daftar penagihan perintah kerja']);
    const inBahasa = buildSettingsPaletteItems(tId, instance, 'Admin', vi.fn()).find((i) => i.id === 'setting-workOrderChecklist')!;
    expect(inBahasa.title).toBe('Pengeditan daftar penagihan perintah kerja');
    expect(inBahasa.searchCodes).toEqual(['Work-order checklist editing', 'Pengeditan daftar penagihan perintah kerja']);
  });

  it('AC-OSM-034 finds the QS report revenue setting in either language and opens its administration page', () => {
    const navigate = vi.fn();
    const entry = buildSettingsPaletteItems(tId, instance, 'Admin', navigate).find((i) => i.id === 'setting-qsReportRevenue')!;
    expect(entry.title).toBe(siteReportId.revenue.qsAccess);
    expect(entry.searchCodes).toEqual([siteReportEn.revenue.qsAccess, siteReportId.revenue.qsAccess]);
    entry.run();
    expect(navigate).toHaveBeenCalledWith('/administration/projects');
    expect(buildSettingsPaletteItems(tEn, instance, 'Quantity Surveyor', vi.fn()).map((i) => i.id)).not.toContain('setting-qsReportRevenue');
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
