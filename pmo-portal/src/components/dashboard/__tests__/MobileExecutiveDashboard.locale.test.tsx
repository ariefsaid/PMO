import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import React from 'react';
import { MemoryRouter } from 'react-router';
import enCatalogue from '../../../../public/locales/en/common.json';
import idCatalogue from '../../../../public/locales/id/common.json';
import enDashboardCatalogue from '../../../../public/locales/en/dashboard.json';
import idDashboardCatalogue from '../../../../public/locales/id/dashboard.json';
import { MobileExecutiveDashboard } from '../MobileExecutiveDashboard';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';

vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));

const data = {
  active_projects: 2,
  total_contract_value: 1000,
  on_hand_margin: 0.25,
  on_hand_value: 800,
  on_hand_contract_remaining: 600,
  on_hand_realized_margin: null,
  on_hand_actual_known: 200,
  on_hand_actual_project_count: 1,
  on_hand_actual_project_total: 2,
  on_hand_actual_coverage_count: 2,
  on_hand_actual_coverage_total: 2,
  pipeline_weighted_value: 0,
  pipeline_projected_margin: 0,
  pipeline_total_value: 0,
  projects_at_risk: 1,
  projects_by_status: [],
  procurements_by_status: [],
  top_projects: [],
} as Parameters<typeof MobileExecutiveDashboard>[0]['data'];

describe('AC-UXS-006 dashboard copy — mobile Executive Bahasa labels', () => {
  afterEach(() => resetActiveLocale());

  it('uses the known small spend in the accessible link name instead of the unavailable reason', async () => {
    const i18n = i18next.createInstance();
    await i18n.init({
      lng: 'en',
      fallbackLng: 'en',
      defaultNS: 'common',
      resources: { en: { common: enCatalogue } },
    });

    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <MobileExecutiveDashboard data={data} riskCheckable={true} approvalCount={0} belowFold={null} />
        </MemoryRouter>
      </I18nextProvider>,
    );

    expect(screen.getByRole('link', { name: 'Open spend breakdown · $200 spent to date' })).toBeInTheDocument();
  });

  it('AC-RD-UNAVAIL-002: the spend link announces a known 0 or 500, and the reason only when spend is unknown', async () => {
    const i18n = i18next.createInstance();
    await i18n.init({ lng: 'en', fallbackLng: 'en', defaultNS: 'common', resources: { en: { common: enCatalogue } } });
    const cases: Array<[number | null, RegExp]> = [[0, /\$0 spent/], [500, /\$500 spent/], [null, /Not available yet spent/]];
    for (const [spend, name] of cases) {
      const { unmount } = render(
        <I18nextProvider i18n={i18n}>
          <MemoryRouter>
            <MobileExecutiveDashboard data={{ ...data, on_hand_actual_known: spend as number }} riskCheckable={true} approvalCount={0} belowFold={null} />
          </MemoryRouter>
        </I18nextProvider>,
      );
      const link = screen.getByRole('link', { name: /Open spend breakdown/ });
      expect(link).toHaveAccessibleName(name);
      if (spend !== null) expect(link).not.toHaveAccessibleName(/Not available yet/);
      // No interactive dash nested inside the drill link.
      expect(link.querySelector('button')).toBeNull();
      unmount();
    }
  });

  it('formats the exact spend with the configured number locale, not the UI language', async () => {
    setActiveLocale({ locale: 'en', numberLocale: 'id-ID', timezone: 'UTC' });
    const i18n = i18next.createInstance();
    await i18n.init({
      lng: 'en',
      fallbackLng: 'en',
      defaultNS: 'common',
      resources: { en: { common: enCatalogue } },
    });
    const localizedData = { ...data, on_hand_actual_known: 1_200_000 };

    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <MobileExecutiveDashboard data={localizedData} riskCheckable={true} approvalCount={0} belowFold={null} />
        </MemoryRouter>
      </I18nextProvider>,
    );

    const spendLink = screen.getByRole('link', { name: /US\$1\.200\.000/ });
    expect(spendLink.querySelector('[title]')).toHaveAttribute('title', 'US$1.200.000');
    expect(spendLink.querySelector('.sr-only')).toHaveTextContent('US$1.200.000');
  });

  it('keeps the contract-book accessible name, risk link, and KPI help in Bahasa', async () => {
    const i18n = i18next.createInstance();
    await i18n.init({
      lng: 'id',
      fallbackLng: 'en',
      defaultNS: 'common',
      fallbackNS: 'common',
      resources: {
        en: { common: enCatalogue, dashboard: enDashboardCatalogue },
        id: { common: idCatalogue, dashboard: idDashboardCatalogue },
      },
    });

    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <MobileExecutiveDashboard data={data} riskCheckable={true} approvalCount={0} belowFold={null} />
        </MemoryRouter>
      </I18nextProvider>,
    );

    expect(screen.getByTestId('mobile-contract-book')).toHaveAttribute('aria-label', 'Portofolio kontrak');
    expect(screen.getByRole('link', { name: /\$200/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tinjau 1 proyek berisiko' })).toHaveAttribute(
      'href',
      '/projects?filter=at-risk',
    );
    expect(screen.getByRole('button', { name: /^Tentang metrik ini: \S/ })).toBeInTheDocument();
  });
});
