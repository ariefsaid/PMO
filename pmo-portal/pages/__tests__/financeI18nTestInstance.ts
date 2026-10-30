import { createInstance } from 'i18next';
import en from '../../public/locales/en/common.json';
import id from '../../public/locales/id/common.json';
import enFinance from '../../public/locales/en/finance.json';
import idFinance from '../../public/locales/id/finance.json';
import enProject from '../../public/locales/en/project.json';
import idProject from '../../public/locales/id/project.json';
import enProcurement from '../../public/locales/en/procurement.json';
import idProcurement from '../../public/locales/id/procurement.json';
import enProjects from '../../public/locales/en/projects.json';
import idProjects from '../../public/locales/id/projects.json';

export const financeTestI18n = createInstance();
export const financeTestI18nReady = financeTestI18n.init({
  lng: 'en',
  fallbackLng: 'en',
  defaultNS: 'common',
  fallbackNS: 'common',
  ns: ['common', 'finance', 'project', 'procurement', 'projects'],
  resources: {
    en: { common: en, finance: enFinance, project: enProject, procurement: enProcurement, projects: enProjects },
    id: { common: id, finance: idFinance, project: idProject, procurement: idProcurement, projects: idProjects },
  },
  interpolation: { escapeValue: false },
  initImmediate: false,
  react: { useSuspense: false },
});
