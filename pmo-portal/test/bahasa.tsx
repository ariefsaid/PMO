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

const EN_PAGES = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/commonPages.json'), 'utf8'));
const ID_PAGES = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/commonPages.json'), 'utf8'));
const EN = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/common.json'), 'utf8'));
const ID = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/common.json'), 'utf8'));
const EN_DASHBOARD = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/dashboard.json'), 'utf8'));
const ID_DASHBOARD = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/dashboard.json'), 'utf8'));
const EN_FINANCE = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/finance.json'), 'utf8'));
const ID_FINANCE = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/finance.json'), 'utf8'));
const EN_FINANCE_HUB = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/financeHub.json'), 'utf8'));
const ID_FINANCE_HUB = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/financeHub.json'), 'utf8'));
const EN_PROCUREMENT = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/procurement.json'), 'utf8'));
const ID_PROCUREMENT = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/procurement.json'), 'utf8'));
const EN_RECORD_FOLDERS = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/recordFolders.json'), 'utf8'));
const ID_RECORD_FOLDERS = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/recordFolders.json'), 'utf8'));
const EN_ASSISTANT_PANEL = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/assistantPanel.json'), 'utf8'));
const ID_ASSISTANT_PANEL = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/assistantPanel.json'), 'utf8'));
const EN_PROJECT = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/project.json'), 'utf8'));
const ID_PROJECT = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/project.json'), 'utf8'));
const EN_SALES = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/sales.json'), 'utf8'));
const ID_SALES = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/sales.json'), 'utf8'));
const EN_PROJECTS = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/projects.json'), 'utf8'));
const ID_PROJECTS = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/projects.json'), 'utf8'));
const EN_STATUS = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/status.json'), 'utf8'));
const ID_STATUS = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/status.json'), 'utf8'));
const EN_INCIDENTS = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/incidents.json'), 'utf8'));
const ID_INCIDENTS = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/incidents.json'), 'utf8'));
const EN_LOST_REASON = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/lostReason.json'), 'utf8'));
const ID_LOST_REASON = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/lostReason.json'), 'utf8'));

const EN_STOCK = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/stock.json'), 'utf8'));
const ID_STOCK = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/stock.json'), 'utf8'));

const EN_ADMINISTRATION = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/administration.json'), 'utf8'));
const ID_ADMINISTRATION = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/administration.json'), 'utf8'));
const EN_TIMESHEETS = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/timesheets.json'), 'utf8'));
const ID_TIMESHEETS = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/timesheets.json'), 'utf8'));
const EN_REFUSALS = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/refusals.json'), 'utf8'));
const ID_REFUSALS = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/refusals.json'), 'utf8'));

const EN_CREWS = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/crews.json'), 'utf8'));
const ID_CREWS = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/crews.json'), 'utf8'));

function makeBahasaI18n(locale: 'en' | 'id') {
  const i18n = i18next.createInstance();
  void i18n.init({
    lng: locale,
    fallbackLng: 'en',
    ns: ['common', 'commonPages', 'dashboard', 'finance', 'procurement', 'recordFolders', 'assistantPanel', 'project', 'projects', 'sales', 'lostReason', 'status', 'incidents', 'administration', 'stock', 'timesheets', 'refusals', 'crews'],
    defaultNS: 'common',
    fallbackNS: ['common', 'commonPages'],
    resources: {
      id: { common: ID, commonPages: ID_PAGES, dashboard: ID_DASHBOARD, finance: ID_FINANCE, financeHub: ID_FINANCE_HUB, procurement: ID_PROCUREMENT, recordFolders: ID_RECORD_FOLDERS, assistantPanel: ID_ASSISTANT_PANEL, project: ID_PROJECT, projects: ID_PROJECTS, sales: ID_SALES, lostReason: ID_LOST_REASON, status: ID_STATUS, incidents: ID_INCIDENTS, administration: ID_ADMINISTRATION, stock: ID_STOCK, timesheets: ID_TIMESHEETS, refusals: ID_REFUSALS, crews: ID_CREWS },
      en: { common: EN, commonPages: EN_PAGES, dashboard: EN_DASHBOARD, finance: EN_FINANCE, financeHub: EN_FINANCE_HUB, procurement: EN_PROCUREMENT, recordFolders: EN_RECORD_FOLDERS, assistantPanel: EN_ASSISTANT_PANEL, project: EN_PROJECT, projects: EN_PROJECTS, sales: EN_SALES, lostReason: EN_LOST_REASON, status: EN_STATUS, incidents: EN_INCIDENTS, administration: EN_ADMINISTRATION, stock: EN_STOCK, timesheets: EN_TIMESHEETS, refusals: EN_REFUSALS, crews: EN_CREWS },
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
