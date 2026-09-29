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

function makeBahasaI18n() {
  const i18n = i18next.createInstance();
  void i18n.init({
    lng: 'id',
    fallbackLng: 'en',
    defaultNS: 'common',
    resources: { id: { common: ID }, en: { common: EN } },
    initImmediate: false,
    interpolation: { escapeValue: false },
  });
  return i18n;
}

export const BahasaProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // One instance per mount — a new instance per render would reset every consumer's `t`.
  const [i18n] = React.useState(makeBahasaI18n);
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
};
