/**
 * Test helper: render a tree under a REAL `id` i18next instance loaded from the shipped
 * catalogues, so a test asserts what a Bahasa user actually reads — not the English defaults the
 * shared setup instance falls back to. The `en` catalogue rides along as `fallbackLng`, exactly as
 * at runtime (FR-L10N-041).
 */
import React from 'react';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const EN = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/common.json'), 'utf8'));
const ID = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/common.json'), 'utf8'));
const EN_DASHBOARD = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/dashboard.json'), 'utf8'));
const ID_DASHBOARD = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/dashboard.json'), 'utf8'));
const EN_FINANCE = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/finance.json'), 'utf8'));
const ID_FINANCE = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/finance.json'), 'utf8'));
const EN_PROCUREMENT = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/procurement.json'), 'utf8'));
const ID_PROCUREMENT = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/procurement.json'), 'utf8'));
const EN_RECORD_FOLDERS = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/recordFolders.json'), 'utf8'));
const ID_RECORD_FOLDERS = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/recordFolders.json'), 'utf8'));
const EN_ASSISTANT_PANEL = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/assistantPanel.json'), 'utf8'));
const ID_ASSISTANT_PANEL = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/assistantPanel.json'), 'utf8'));

function makeBahasaI18n(locale: 'en' | 'id') {
  const i18n = i18next.createInstance();
  void i18n.init({
    lng: locale,
    fallbackLng: 'en',
    ns: ['common', 'dashboard', 'finance', 'procurement', 'recordFolders', 'assistantPanel'],
    defaultNS: 'common',
    fallbackNS: 'common',
    resources: {
      id: { common: ID, dashboard: ID_DASHBOARD, finance: ID_FINANCE, procurement: ID_PROCUREMENT, recordFolders: ID_RECORD_FOLDERS, assistantPanel: ID_ASSISTANT_PANEL },
      en: { common: EN, dashboard: EN_DASHBOARD, finance: EN_FINANCE, procurement: EN_PROCUREMENT, recordFolders: EN_RECORD_FOLDERS, assistantPanel: EN_ASSISTANT_PANEL },
    },
    initImmediate: false,
    interpolation: { escapeValue: false },
  });
  return i18n;
}

export const BahasaProvider: React.FC<{ children: React.ReactNode; locale?: 'en' | 'id' }> = ({ children, locale = 'id' }) => {
  // One instance per mount — a new instance per render would reset every consumer's `t`.
  const [i18n] = React.useState(() => makeBahasaI18n(locale));
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
};
