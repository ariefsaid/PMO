import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import React from 'react';
import { MemoryRouter } from 'react-router';
import enCatalogue from '../../../../public/locales/en/common.json';
import idCatalogue from '../../../../public/locales/id/common.json';
import { MobileExecutiveDashboard } from '../MobileExecutiveDashboard';

vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));

const data = {
  active_projects: 2,
  total_contract_value: 1000,
  on_hand_margin: 0.25,
  on_hand_value: 800,
  pipeline_weighted_value: 0,
  pipeline_projected_margin: 0,
  pipeline_total_value: 0,
  projects_at_risk: 1,
  projects_by_status: [],
  procurements_by_status: [],
  top_projects: [],
} as Parameters<typeof MobileExecutiveDashboard>[0]['data'];

describe('AC-UXS-006 dashboard copy — mobile Executive Bahasa labels', () => {
  it('keeps the contract-book accessible name, risk link, and KPI help in Bahasa', async () => {
    const i18n = i18next.createInstance();
    await i18n.init({
      lng: 'id',
      fallbackLng: 'en',
      defaultNS: 'common',
      resources: { en: { common: enCatalogue }, id: { common: idCatalogue } },
    });

    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <MobileExecutiveDashboard data={data} approvalCount={0} belowFold={null} />
        </MemoryRouter>
      </I18nextProvider>,
    );

    expect(screen.getByTestId('mobile-contract-book')).toHaveAttribute('aria-label', 'Portofolio kontrak');
    expect(screen.getByRole('link', { name: 'Tinjau 1 proyek berisiko' })).toHaveAttribute(
      'href',
      '/projects?filter=at-risk',
    );
    expect(screen.getByRole('button', { name: /^Tentang metrik ini: \S/ })).toBeInTheDocument();
  });
});
