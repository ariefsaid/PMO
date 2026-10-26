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
const EN_PROJECT = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/project.json'), 'utf8'));
const ID_PROJECT = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/project.json'), 'utf8'));
const EN_SHELL = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/shell.json'), 'utf8'));
const ID_SHELL = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/shell.json'), 'utf8'));
const EN_ADMINISTRATION = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/administration.json'), 'utf8'));
const ID_ADMINISTRATION = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/administration.json'), 'utf8'));
const EN_INTEGRATIONS = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/integrations.json'), 'utf8'));
const ID_INTEGRATIONS = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/integrations.json'), 'utf8'));
const EN_M365_DOCUMENTS = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/m365Documents.json'), 'utf8'));
const ID_M365_DOCUMENTS = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/m365Documents.json'), 'utf8'));
const EN_PROJECTS = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/projects.json'), 'utf8'));
const ID_PROJECTS = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/projects.json'), 'utf8'));
const EN_PROCUREMENT = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/procurement.json'), 'utf8'));
const ID_PROCUREMENT = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/procurement.json'), 'utf8'));
const EN_EXPENSE_CLAIMS = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/expenseClaims.json'), 'utf8'));
const ID_EXPENSE_CLAIMS = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/expenseClaims.json'), 'utf8'));

function makeBahasaI18n(locale: 'en' | 'id') {
  const i18n = i18next.createInstance();
  void i18n.init({
    lng: locale,
    fallbackLng: 'en',
    defaultNS: 'common',
    fallbackNS: 'common',
    ns: ['common', 'dashboard', 'finance', 'project', 'projects', 'shell', 'administration', 'integrations', 'm365Documents', 'procurement', 'expenseClaims'],
    resources: {
      id: {
        common: ID,
        projects: ID_PROJECTS,
        dashboard: ID_DASHBOARD,
        finance: ID_FINANCE,
        project: ID_PROJECT,
        shell: ID_SHELL,
        administration: ID_ADMINISTRATION,
        integrations: ID_INTEGRATIONS,
        m365Documents: ID_M365_DOCUMENTS,
        procurement: ID_PROCUREMENT,
        expenseClaims: ID_EXPENSE_CLAIMS,
      },
      en: {
        common: EN,
        projects: EN_PROJECTS,
        dashboard: EN_DASHBOARD,
        finance: EN_FINANCE,
        project: EN_PROJECT,
        shell: EN_SHELL,
        administration: EN_ADMINISTRATION,
        integrations: EN_INTEGRATIONS,
        m365Documents: EN_M365_DOCUMENTS,
        procurement: EN_PROCUREMENT,
        expenseClaims: EN_EXPENSE_CLAIMS,
      },
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
