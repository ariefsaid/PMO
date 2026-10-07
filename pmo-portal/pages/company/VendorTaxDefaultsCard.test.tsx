import React from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
const h = vi.hoisted(() => ({ canManage: true, setTaxDefaults: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { company: { setTaxDefaults: h.setTaxDefaults } } }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.canManage }));
import { VendorTaxDefaultsCard } from './VendorTaxDefaultsCard';
import type { CompanyRow } from '@/src/lib/db/companies';
import { FinanceI18nTestProvider } from '@/pages/__tests__/financeI18nTestProvider';
import { financeTestI18n, financeTestI18nReady } from '@/pages/__tests__/financeI18nTestInstance';

const VENDOR = { id: 'vendor-1', org_id: 'org-1', name: 'Apex Supply', type: 'Vendor',
  default_vat_rate: null, default_pph_type: null, default_pph_rate: null } as unknown as CompanyRow;
const WITH_DEFAULTS = { ...VENDOR, default_vat_rate: 11, default_pph_type: 'pph23', default_pph_rate: 2 } as unknown as CompanyRow;

function renderCard(company: CompanyRow = VENDOR) {
  render(
    <FinanceI18nTestProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider><VendorTaxDefaultsCard company={company} /></ToastProvider>
      </QueryClientProvider>
    </FinanceI18nTestProvider>,
  );
}

beforeAll(async () => { await financeTestI18nReady; });
beforeEach(async () => {
  vi.clearAllMocks();
  h.canManage = true;
  h.setTaxDefaults.mockResolvedValue(undefined);
  await financeTestI18n.changeLanguage('en');
});

describe('VendorTaxDefaultsCard (#876 slice 2, OD-VWH-1)', () => {
  it('AC-VWH-028 Finance sets VAT 11% and PPh 23 at 2%', async () => {
    renderCard();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('VAT rate (%)'), '11');
    await user.selectOptions(screen.getByLabelText('Withholding'), 'pph23');
    await user.type(screen.getByLabelText('PPh rate (%)'), '2');
    await user.click(screen.getByRole('button', { name: 'Save defaults' }));
    expect(h.setTaxDefaults).toHaveBeenCalledWith('vendor-1', { vatRate: 11, pphType: 'pph23', pphRate: 2 });
  });

  it('AC-VWH-028 choosing no withholding hides the PPh rate and saves none', async () => {
    renderCard(WITH_DEFAULTS);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Withholding'), '');
    expect(screen.queryByLabelText('PPh rate (%)')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save defaults' }));
    expect(h.setTaxDefaults).toHaveBeenCalledWith('vendor-1', { vatRate: 11, pphType: null, pphRate: null });
  });

  it('AC-VWH-028 a VAT rate above 100% blocks the save with a message', async () => {
    renderCard();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('VAT rate (%)'), '101');
    expect(screen.getByText('Enter a rate from 0 to 100 with no more than 3 decimal places, or leave it blank.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save defaults' })).toBeDisabled();
    expect(h.setTaxDefaults).not.toHaveBeenCalled();
  });

  it('AC-VWH-028 a role without the right sees the defaults read-only', () => {
    h.canManage = false;
    renderCard(WITH_DEFAULTS);
    expect(screen.getByTestId('vendor-tax-defaults-summary')).toHaveTextContent('VAT 11% · PPh 23 at 2%');
    expect(screen.queryByRole('button', { name: 'Save defaults' })).toBeNull();
  });

  it('AC-VWH-028 a PPh-rate error waits for the rate field: pristine shows none, an invalid rate shows it', async () => {
    renderCard();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Withholding'), 'pph23');
    // The rate field is pristine and empty — no eager error (the disabled Save is the gate).
    expect(screen.queryByText('Enter a rate above 0 and below 100 with no more than 3 decimal places.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save defaults' })).toBeDisabled();
    await user.type(screen.getByLabelText('PPh rate (%)'), '0');
    expect(screen.getByText('Enter a rate above 0 and below 100 with no more than 3 decimal places.')).toBeInTheDocument();
  });

  it('AC-VWH-028 the card renders in Bahasa Indonesia', async () => {
    await financeTestI18n.changeLanguage('id');
    renderCard();
    expect(screen.getByText('Default pajak vendor')).toBeInTheDocument();
    expect(screen.getByLabelText('Tarif PPN (%)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Simpan default' })).toBeInTheDocument();
  });
});
