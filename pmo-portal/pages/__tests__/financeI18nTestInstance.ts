import { createInstance } from 'i18next';
import en from '../../public/locales/en/common.json';
import id from '../../public/locales/id/common.json';
import enProject from '../../public/locales/en/project.json';
import idProject from '../../public/locales/id/project.json';

export const financeTestI18n = createInstance();
export const financeTestI18nReady = financeTestI18n.init({
  lng: 'en',
  fallbackLng: 'en',
  defaultNS: 'common',
  ns: ['common', 'project'],
  resources: { en: { common: en, project: enProject }, id: { common: id, project: idProject } },
  interpolation: { escapeValue: false },
  initImmediate: false,
  react: { useSuspense: false },
});
