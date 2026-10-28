import { createInstance } from 'i18next';
import en from '../../public/locales/en/common.json';
import id from '../../public/locales/id/common.json';
import financeEn from '../../public/locales/en/finance.json';
import financeId from '../../public/locales/id/finance.json';

export const financeTestI18n = createInstance();
export const financeTestI18nReady = financeTestI18n.init({
  lng: 'en',
  fallbackLng: 'en',
  defaultNS: 'common',
  resources: { en: { common: en, finance: financeEn }, id: { common: id, finance: financeId } },
  interpolation: { escapeValue: false },
  initImmediate: false,
  react: { useSuspense: false },
});
