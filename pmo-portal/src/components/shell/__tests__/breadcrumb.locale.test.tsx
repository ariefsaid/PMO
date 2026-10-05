/**
 * FR-L10N — the Administration parent/section breadcrumbs and the personal integrations
 * breadcrumb render the SAME translated labels the shell already uses, in a Bahasa session.
 *
 * The shell's rail already localizes "Administration" / "My integrations" via i18n; the route-
 * derived breadcrumb must agree in every locale instead of leaking English constants. These tests
 * render the real <Breadcrumb> under an `id` i18n instance to prove the rendered text is Bahasa.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Breadcrumb } from '../Breadcrumb';
import { breadcrumbForPath } from '../routeMatch';

// Load the REAL shipped catalogues (tests run with cwd = pmo-portal) so the assertions pin the
// actual Bahasa labels the shell ships, not a hand-copied copy that could drift from the catalogue.
const idCatalogue = JSON.parse(
  readFileSync(join(process.cwd(), 'public/locales/id/common.json'), 'utf8'),
);
const enCatalogue = JSON.parse(
  readFileSync(join(process.cwd(), 'public/locales/en/common.json'), 'utf8'),
);

let i18n: typeof i18next;

beforeEach(async () => {
  i18n = i18next.createInstance();
  await i18n.init({
    lng: 'id',
    fallbackLng: 'en',
    defaultNS: 'common',
    resources: {
      id: { common: idCatalogue },
      en: { common: enCatalogue },
    },
  });
});

const renderBreadcrumb = (path: string) =>
  render(
    <I18nextProvider i18n={i18n}>
      <Breadcrumb parts={breadcrumbForPath(path)} />
    </I18nextProvider>,
  );

describe('FR-L10N — Bahasa Administration breadcrumbs agree with the shell', () => {
  it('AC-ADMIA-004: the Administration parent crumb reads "Administrasi", not "Administration"', () => {
    renderBreadcrumb('/administration/users');
    expect(screen.getByText('Administrasi')).toBeInTheDocument();
    expect(screen.queryByText('Administration')).not.toBeInTheDocument();
  });

  it('AC-ADMIA-004: every section crumb uses the translated shell label', () => {
    const cases = [
      ['/administration/users', 'Pengguna'],
      ['/administration/integrations', 'Integrasi organisasi'],
      ['/administration/accounting', 'Pengaturan akuntansi'],
      ['/administration/credits', 'Kredit'],
      ['/administration/usage', 'Pemakaian'],
      ['/administration/features', 'Fitur'],
    ] as const;
    for (const [path, bahasa] of cases) {
      const view = renderBreadcrumb(path);
      expect(screen.getByText(bahasa)).toBeInTheDocument();
      view.unmount();
    }
  });

  it('AC-ADMIA-006: the personal integrations crumb reads "Integrasi saya", not "My integrations"', () => {
    renderBreadcrumb('/integrations');
    expect(screen.getByText('Integrasi saya')).toBeInTheDocument();
    expect(screen.queryByText('My integrations')).not.toBeInTheDocument();
  });

  // #781 (AC-FIN-002): the three Finance routes each carry their own rail breadcrumb label (and a
  // real i18n key), so a direct deep-link never falls through to the "Not found" fallback.
  it('AC-FIN-002: each Finance route renders its own Bahasa shell label, never "Not found"', () => {
    const cases = [
      ['/sales-invoices', 'Invoice Penjualan'],
      ['/incoming-payments', 'Pembayaran Masuk'],
      ['/revenue-by-project', 'Pendapatan per Proyek'],
    ] as const;
    for (const [path, bahasa] of cases) {
      const view = renderBreadcrumb(path);
      expect(screen.getByText(bahasa)).toBeInTheDocument();
      view.unmount();
    }
  });

  it('AC-FIN-002: breadcrumbForPath resolves the three Finance paths without a "Not found" part', () => {
    for (const path of ['/sales-invoices', '/incoming-payments', '/revenue-by-project']) {
      const parts = breadcrumbForPath(path);
      expect(parts.map((p) => p.label)).not.toContain('Not found');
    }
  });
});
