import type { i18n as I18n, TFunction } from 'i18next';
import type { Role } from '@/src/auth/AuthContext';
import { can } from '@/src/auth/policy';
import type { PaletteItem } from '@/src/components/shell';
import { ORG_SETTINGS, orgSettingKeys } from '@/src/lib/orgSettingsCatalogue';
import { orgSettingText } from '@/src/lib/orgSettingsText';

const english = ((_key: string, fallback: string) => fallback) as unknown as TFunction;

/**
 * One ⌘K entry per organisation setting the signed-in role may change (#2746), plus "All settings". Searching matches the setting's
 * name in the interface language, in English, and in Bahasa when that catalogue is loaded; picking one opens where it is changed.
 * Names are not translated by the palette's own filter, so the English and Bahasa names go in as extra search words.
 */
export function buildSettingsPaletteItems(
  t: TFunction, i18n: I18n, role: Role | undefined, navigate: (to: string) => void,
): PaletteItem[] {
  if (!role) return [];
  const mine = orgSettingKeys.filter((k) => (ORG_SETTINGS[k].writers as readonly Role[]).includes(role));
  const seeAll = can('view', 'user', { realRole: role });
  if (mine.length === 0 && !seeAll) return [];
  const here = orgSettingText(t);
  const en = orgSettingText(english);
  const id = i18n.hasResourceBundle('id', 'common') ? orgSettingText(i18n.getFixedT('id')) : undefined;
  return [
    ...(seeAll ? [{
      id: 'setting-all', group: 'Settings', title: t('allSettings.title', 'All settings'), icon: 'admin' as const,
      run: () => navigate('/administration/all-settings'),
    }] : []),
    ...mine.map((k): PaletteItem => ({
      id: `setting-${k}`, group: 'Settings', title: here[k].name, sub: here[k].summary, icon: 'admin' as const,
      searchCodes: [...new Set([en[k].name, id?.[k].name].filter((n): n is string => Boolean(n)))],
      run: () => navigate(ORG_SETTINGS[k].route),
    })),
  ];
}
