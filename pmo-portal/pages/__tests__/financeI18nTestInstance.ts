import { createInstance } from 'i18next';
import en from '../../public/locales/en/common.json';
import id from '../../public/locales/id/common.json';
import enWork from '../../public/locales/en/work.json';
import idWork from '../../public/locales/id/work.json';

export const financeTestI18n = createInstance();
export const financeTestI18nReady = financeTestI18n.init({
  lng: 'en',
  fallbackLng: 'en',
  defaultNS: 'common',
  ns: ['common', 'work'],
  resources: { en: { common: en, work: enWork }, id: { common: id, work: idWork } },
  interpolation: { escapeValue: false },
  initImmediate: false,
  react: { useSuspense: false },
});
