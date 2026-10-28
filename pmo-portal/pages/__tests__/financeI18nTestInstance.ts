import { createInstance } from 'i18next';
import en from '../../public/locales/en/common.json';
import id from '../../public/locales/id/common.json';
import financeEn from '../../public/locales/en/finance.json';
import financeId from '../../public/locales/id/finance.json';
import projectTabsEn from '../../public/locales/en/projectTabs.json';
import projectTabsId from '../../public/locales/id/projectTabs.json';

export const financeTestI18n = createInstance();
export const financeTestI18nReady = financeTestI18n.init({
  lng: 'en',
  fallbackLng: 'en',
  defaultNS: 'common',
  resources: {
    en: { common: en, finance: financeEn, projectTabs: projectTabsEn },
    id: { common: id, finance: financeId, projectTabs: projectTabsId },
  },
  interpolation: { escapeValue: false },
  initImmediate: false,
  react: { useSuspense: false },
});
