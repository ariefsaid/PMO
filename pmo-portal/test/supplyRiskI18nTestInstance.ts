import { createInstance } from 'i18next';
import en from '../public/locales/en/supplyRisk.json';
import id from '../public/locales/id/supplyRisk.json';
import enCommon from '../public/locales/en/common.json';
import enPages from '../public/locales/en/commonPages.json';

/** A minimal i18n instance carrying the supply-risk catalogue (and common as the fallback) for component tests. */
export const supplyRiskTestI18n = createInstance();
export const supplyRiskTestI18nReady = supplyRiskTestI18n.init({
  lng: 'en',
  fallbackLng: 'en',
  defaultNS: 'common',
  fallbackNS: ['common', 'commonPages'],
  ns: ['common', 'commonPages', 'supplyRisk'],
  resources: { en: { common: enCommon, commonPages: enPages, supplyRisk: en }, id: { common: enCommon, commonPages: enPages, supplyRisk: id } },
  interpolation: { escapeValue: false },
  initImmediate: false,
  react: { useSuspense: false },
});
