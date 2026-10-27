import { createInstance } from 'i18next';
import en from '../../public/locales/en/common.json';
import id from '../../public/locales/id/common.json';

export const financeTestI18n = createInstance();
export const financeTestI18nReady = financeTestI18n.init({
  lng: 'en',
  fallbackLng: 'en',
  defaultNS: 'common',
  resources: { en: { common: en }, id: { common: id } },
  interpolation: { escapeValue: false },
  initImmediate: false,
  react: { useSuspense: false },
});
