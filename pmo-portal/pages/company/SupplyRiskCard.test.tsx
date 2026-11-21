import React from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({
  canView: true, canSet: true,
  suggestion: vi.fn(), exposure: vi.fn(), setStatus: vi.fn(), setterName: vi.fn(),
}));
vi.mock('@/src/lib/repositories', () => ({
  repositories: { supplyRisk: { suggestion: h.suggestion, exposure: h.exposure, setStatus: h.setStatus, setterName: h.setterName } },
}));
vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => (action: string) => (action === 'view' ? h.canView : h.canSet),
}));
import { queryClient } from '@/src/lib/queryClient';
import { SupplyRiskCard } from './SupplyRiskCard';
import type { CompanyRow } from '@/src/lib/db/companies';
import { I18nextProvider } from 'react-i18next';
import { supplyRiskTestI18n, supplyRiskTestI18nReady } from '../../test/supplyRiskI18nTestInstance';

const VENDOR = { id: 'v1', org_id: 'o1', name: 'Apex Supply', type: 'Vendor', supply_risk_status: 'active',
  supply_risk_reason: null, supply_risk_set_by: null, supply_risk_set_at: null } as unknown as CompanyRow;

const PMO_AT_RISK = {
  basis: 'pmo', suggestedStatus: 'at_risk', noAgingData: false, unknownCount: 0, oldestAgeDays: 111,
  currencies: [{ currency: 'IDR', unpaidAmount: 3_600_000, over60Amount: 1_600_000, invoiceCount: 2, oldestAgeDays: 111 }],
};

function renderCard(company: CompanyRow = VENDOR) {
  render(
    <I18nextProvider i18n={supplyRiskTestI18n}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter><ToastProvider><SupplyRiskCard company={company} /></ToastProvider></MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

beforeAll(async () => { await supplyRiskTestI18nReady; });
beforeEach(() => {
  queryClient.clear();
  vi.clearAllMocks();
  h.canView = true; h.canSet = true;
  h.suggestion.mockResolvedValue(PMO_AT_RISK);
  h.exposure.mockResolvedValue([
    { kind: 'work_order', workOrderId: 'wo1', woNumber: 'WO-1', title: 'Pump install', woStatus: 'Issued', projectId: 'p1', projectName: 'Plant A', openOrderCount: 2, orderTotal: 500, currency: 'IDR' },
    { kind: 'project', workOrderId: null, woNumber: null, title: null, woStatus: null, projectId: 'p2', projectName: 'Plant B', openOrderCount: 1, orderTotal: 50, currency: 'IDR' },
  ]);
  h.setStatus.mockResolvedValue(undefined);
  h.setterName.mockResolvedValue('Fina Finance');
});

describe('SupplyRiskCard (AC-VSR-015, FR-VSR-009/010)', () => {
  it('states the suggestion in the words the PMO basis supports, beside the stored status', async () => {
    renderCard();
    expect(await screen.findByText(/Suggested: at risk, 2 invoices over 60 days, .*1,600,000/)).toBeInTheDocument();
    expect(screen.getByTestId('supply-risk-current')).toHaveTextContent('Active');
    expect(screen.getByTestId('supply-risk-differs')).toHaveTextContent('The stored status is active; it differs from the suggestion.');
  });

  it('the suggestion never changes the status by itself', async () => {
    renderCard();
    await screen.findByTestId('supply-risk-set-suggested');
    expect(h.setStatus).not.toHaveBeenCalled();
  });

  it('"Set to suggested" asks why, then saves through the governed write', async () => {
    renderCard();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('supply-risk-set-suggested'));
    expect(screen.getByLabelText(/Reason/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save status' }));
    expect(await screen.findByText('Say why')).toBeInTheDocument();
    expect(h.setStatus).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText(/Reason/), 'Payments 90 days late');
    await user.click(screen.getByRole('button', { name: 'Save status' }));
    expect(h.setStatus).toHaveBeenCalledWith('v1', 'at_risk', 'Payments 90 days late');
  });

  it('shows who set the status and when, with the reason', async () => {
    renderCard({ ...VENDOR, supply_risk_status: 'at_risk', supply_risk_reason: 'Late', supply_risk_set_by: 'u1', supply_risk_set_at: '2026-11-20T03:00:00Z' } as unknown as CompanyRow);
    expect(await screen.findByText(/Set by Fina Finance on/)).toBeInTheDocument();
    expect(screen.getByTestId('supply-risk-reason')).toHaveTextContent('Reason: Late');
  });

  it('lists the exposed work orders and the project-level orders (FR-VSR-011, 015)', async () => {
    renderCard();
    expect(await screen.findByTestId('supply-risk-exposed-wo')).toHaveTextContent('WO-1 · Pump install');
    expect(screen.getByTestId('supply-risk-exposed-wo')).toHaveTextContent('2 open orders');
    expect(screen.getByTestId('supply-risk-project-level')).toHaveTextContent('Plant B');
  });

  it('the ERP basis makes no invoice-count claim (FR-VSR-010)', async () => {
    h.suggestion.mockResolvedValue({ basis: 'erp', suggestedStatus: 'at_risk', noAgingData: false, unknownCount: 0, oldestAgeDays: null,
      currencies: [{ currency: 'IDR', unpaidAmount: 500000, over60Amount: 400000, invoiceCount: null, oldestAgeDays: null }] });
    renderCard();
    const line = await screen.findByTestId('supply-risk-suggestion');
    await vi.waitFor(() => expect(line).toHaveTextContent(/Suggested: at risk, .*400,000 over 60 days/));
    expect(line).not.toHaveTextContent(/invoice/);
  });

  it('no aging data offers no suggested status', async () => {
    h.suggestion.mockResolvedValue({ basis: 'erp', suggestedStatus: null, noAgingData: true, unknownCount: 0, oldestAgeDays: null, currencies: [] });
    renderCard();
    expect(await screen.findByText('No aging data for this supplier in the accounting system.')).toBeInTheDocument();
    expect(screen.queryByTestId('supply-risk-set-suggested')).toBeNull();
  });

  it('a role that may not set sees the status but no form', async () => {
    h.canSet = false;
    renderCard();
    expect(await screen.findByText('Only Admin or Finance can change this.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save status' })).toBeNull();
  });

  it('a role without the panel sees nothing (the flag stays readable on the company row)', () => {
    h.canView = false;
    renderCard();
    expect(screen.queryByTestId('supply-risk')).toBeNull();
    expect(h.suggestion).not.toHaveBeenCalled();
  });
});
