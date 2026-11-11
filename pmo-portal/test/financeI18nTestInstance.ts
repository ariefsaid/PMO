import { createInstance } from 'i18next';
import en from '../public/locales/en/common.json';
import id from '../public/locales/id/common.json';
import enFinance from '../public/locales/en/finance.json';
import idFinance from '../public/locales/id/finance.json';
import enProject from '../public/locales/en/project.json';
import idProject from '../public/locales/id/project.json';
import enProcurement from '../public/locales/en/procurement.json';
import idProcurement from '../public/locales/id/procurement.json';
import enProjects from '../public/locales/en/projects.json';
import idProjects from '../public/locales/id/projects.json';
import enProcurementRecord from '../public/locales/en/procurementRecord.json';
import idProcurementRecord from '../public/locales/id/procurementRecord.json';
import enStatus from '../public/locales/en/status.json';
import idStatus from '../public/locales/id/status.json';

export const financeTestI18n = createInstance();
export const financeTestI18nReady = financeTestI18n.init({
  lng: 'en',
  fallbackLng: 'en',
  defaultNS: 'common',
  fallbackNS: 'common',
  ns: ['common', 'finance', 'project', 'procurement', 'projects', 'procurementRecord', 'status'],
  resources: {
    en: { common: en, finance: enFinance, project: enProject, procurement: enProcurement, projects: enProjects, procurementRecord: enProcurementRecord, status: enStatus },
    id: { common: id, finance: idFinance, project: idProject, procurement: idProcurement, projects: idProjects, procurementRecord: idProcurementRecord, status: idStatus },
  },
  interpolation: { escapeValue: false },
  initImmediate: false,
  react: { useSuspense: false },
});
