import { createInstance } from 'i18next';
import en from '../../public/locales/en/common.json';
import id from '../../public/locales/id/common.json';
import enProject from '../../public/locales/en/project.json';
import idProject from '../../public/locales/id/project.json';
import enMoneyIn from '../../public/locales/en/moneyIn.json';
import idMoneyIn from '../../public/locales/id/moneyIn.json';

export const financeTestI18n = createInstance();
export const financeTestI18nReady = financeTestI18n.init({
  lng: 'en',
  fallbackLng: 'en',
  defaultNS: 'common',
  ns: ['common', 'project', 'moneyIn'],
  resources: {
    en: { common: en, project: enProject, moneyIn: enMoneyIn },
    id: { common: id, project: idProject, moneyIn: idMoneyIn },
  },
  interpolation: { escapeValue: false },
  initImmediate: false,
  react: { useSuspense: false },
});
