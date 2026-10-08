/**
 * #876 slice 2 (OD-VWH-1, DD-VWH-13..17) — the "Record vendor invoice" form starts from the vendor's default tax
 * treatment, keeps every amount editable, labels each pre-filled amount with its rate and base, and stages exactly what
 * the user submits: a standalone org stages `withheldAmount` + `withheldPphType` (OQ-VWH-6: the type is stored on every
 * bill that withholds); an ERP-connected org stages `erpTaxAmounts` (or a template) and asks no amount (OQ-VWH-8).
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

const repo = vi.hoisted(() => ({
  getCompany: vi.fn(async () => ({ id: 'vendor-1', default_vat_rate: 11 as number | null, default_pph_type: 'pph23' as string | null, default_pph_rate: 2 as number | null })),
  listTemplates: vi.fn(async () => [{ name: 'Input VAT 11' }]),
}));
vi.mock('@/src/lib/repositories', async (orig) => {
  const actual = (await orig()) as { repositories: Record<string, unknown> };
  return {
    ...actual,
    repositories: {
      ...actual.repositories,
      company: { get: repo.getCompany },
      integrations: { listPurchaseTaxTemplates: repo.listTemplates },
    },
  };
});
vi.mock('@/src/hooks/useOrgTaxDefault', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useOrgTaxDefault: () => undefined };
});

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { RecordCaptureForm } from './RecordCaptureForm';
import { queryClient } from '@/src/lib/queryClient';
import { formatMoneyInputValue } from '@/src/lib/format';
import * as ownership from '@/src/lib/adapterSeam/ownershipCache';
import { FinanceI18nTestProvider } from '@/pages/__tests__/financeI18nTestProvider';
import { financeTestI18n, financeTestI18nReady } from '@/pages/__tests__/financeI18nTestInstance';

function renderVI(props: { vendorId?: string | null; itemsNet?: number | null } = {}, onStage = vi.fn()) {
  render(
    <FinanceI18nTestProvider>
      <ToastProvider>
        <RecordCaptureForm kind="vendor_invoice" onCreate={vi.fn()} onClose={vi.fn()} onStage={onStage} {...props} />
      </ToastProvider>
    </FinanceI18nTestProvider>,
  );
  return onStage;
}
const NO_DEFAULT = { id: 'vendor-1', default_vat_rate: null, default_pph_type: null, default_pph_rate: null };

beforeAll(async () => { await financeTestI18nReady; });
beforeEach(async () => {
  queryClient.clear();
  repo.getCompany.mockClear();
  await financeTestI18n.changeLanguage('en');
});
afterEach(() => vi.restoreAllMocks());

describe('standalone bill (PMO authors the tax) — AC-VWH-030', () => {
  beforeEach(() => { vi.spyOn(ownership, 'routeDomainWrite').mockReturnValue('pmo'); });

  it('AC-VWH-030 pre-fills VAT and PPh from the vendor default, labels their bases, and stages the withholding', async () => {
    const onStage = renderVI({ vendorId: 'vendor-1' });
    await userEvent.type(screen.getByTestId('vi-amount-input'), '1000000');
    await userEvent.selectOptions(screen.getByTestId('vi-tax-treatment-select'), 'exclusive');
    await waitFor(() => expect(screen.getByTestId('vi-tax-amount-input')).toHaveValue(formatMoneyInputValue(110000)));
    await waitFor(() => expect(screen.getByTestId('vi-withheld-input')).toHaveValue(formatMoneyInputValue(20000)));
    expect(screen.getByTestId('vi-pph-type-select')).toHaveValue('pph23');
    expect(screen.getAllByTestId('vi-tax-suggested-from').map((n) => n.textContent)).toEqual([
      `Vendor default 11% of ${formatMoneyInputValue(1000000)}`,
      `Vendor default 2% of ${formatMoneyInputValue(1000000)}`,
    ]);
    await userEvent.click(screen.getByTestId('btn-save-vi'));
    expect(onStage).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'createVI', amount: 1000000, taxTreatment: 'exclusive', taxAmount: 110000, withheldAmount: 20000,
      withheldPphType: 'pph23',
    }));
  });

  it('AC-VWH-030 an edited amount is kept: the VAT follows the bill amount, the edited PPh does not', async () => {
    const onStage = renderVI({ vendorId: 'vendor-1' });
    const amount = screen.getByTestId('vi-amount-input');
    await userEvent.type(amount, '1000000');
    await userEvent.selectOptions(screen.getByTestId('vi-tax-treatment-select'), 'exclusive');
    const withheld = await screen.findByTestId('vi-withheld-input');
    await waitFor(() => expect(withheld).toHaveValue(formatMoneyInputValue(20000)));
    await userEvent.clear(withheld);
    await userEvent.type(withheld, '19999');
    await userEvent.clear(amount);
    await userEvent.type(amount, '2000000');
    await waitFor(() => expect(screen.getByTestId('vi-tax-amount-input')).toHaveValue(formatMoneyInputValue(220000)));
    expect(withheld).toHaveValue(formatMoneyInputValue(19999));
    await userEvent.click(screen.getByTestId('btn-save-vi'));
    expect(onStage).toHaveBeenCalledWith(expect.objectContaining({ taxAmount: 220000, withheldAmount: 19999, withheldPphType: 'pph23' }));
  });

  it('AC-VWH-030 without a vendor default nothing is pre-filled and no withholding records none', async () => {
    repo.getCompany.mockResolvedValueOnce(NO_DEFAULT);
    const onStage = renderVI({ vendorId: 'vendor-1' });
    await userEvent.type(screen.getByTestId('vi-amount-input'), '1000000');
    await userEvent.selectOptions(screen.getByTestId('vi-tax-treatment-select'), 'exclusive');
    await userEvent.type(screen.getByTestId('vi-tax-amount-input'), '0');
    await waitFor(() => expect(repo.getCompany).toHaveBeenCalled());
    expect(screen.getByTestId('vi-pph-type-select')).toHaveValue('');
    expect(screen.queryByTestId('vi-withheld-input')).toBeNull();
    await userEvent.click(screen.getByTestId('btn-save-vi'));
    expect(onStage).toHaveBeenCalledTimes(1);
    expect(onStage.mock.calls[0][0]).not.toHaveProperty('withheldAmount');
    expect(onStage.mock.calls[0][0]).not.toHaveProperty('withheldPphType');
  });

  it('AC-VWH-030 (OQ-VWH-6) a PPh entered by hand stages its type with its amount', async () => {
    repo.getCompany.mockResolvedValueOnce(NO_DEFAULT);
    const onStage = renderVI({ vendorId: 'vendor-1' });
    await userEvent.type(screen.getByTestId('vi-amount-input'), '1000000');
    await userEvent.selectOptions(screen.getByTestId('vi-tax-treatment-select'), 'exclusive');
    await userEvent.type(screen.getByTestId('vi-tax-amount-input'), '0');
    await userEvent.selectOptions(screen.getByTestId('vi-pph-type-select'), 'pph4_2');
    await userEvent.type(screen.getByTestId('vi-withheld-input'), '17500');
    await userEvent.click(screen.getByTestId('btn-save-vi'));
    expect(onStage).toHaveBeenCalledWith(expect.objectContaining({ withheldAmount: 17500, withheldPphType: 'pph4_2' }));
  });

  it('AC-VWH-030 a PPh with no bill amount blocks the save', async () => {
    renderVI();
    await userEvent.selectOptions(screen.getByTestId('vi-tax-treatment-select'), 'exclusive');
    await userEvent.type(screen.getByTestId('vi-tax-amount-input'), '0');
    await userEvent.selectOptions(screen.getByTestId('vi-pph-type-select'), 'pph23');
    await userEvent.type(screen.getByTestId('vi-withheld-input'), '5000');
    expect(screen.getByTestId('btn-save-vi')).toBeDisabled();
  });

  it('AC-VWH-030 switching the type away from the default clears the suggested amount; an edited amount is kept', async () => {
    const onStage = renderVI({ vendorId: 'vendor-1' });
    await userEvent.type(screen.getByTestId('vi-amount-input'), '1000000');
    await userEvent.selectOptions(screen.getByTestId('vi-tax-treatment-select'), 'exclusive');
    const withheld = await screen.findByTestId('vi-withheld-input');
    await waitFor(() => expect(withheld).toHaveValue(formatMoneyInputValue(20000)));
    // Not edited: the 20,000 belonged to PPh 23 — switching types must not carry it over.
    await userEvent.selectOptions(screen.getByTestId('vi-pph-type-select'), 'pph4_2');
    expect(withheld).toHaveValue('');
    await userEvent.type(withheld, '10000');
    await userEvent.click(screen.getByTestId('btn-save-vi'));
    expect(onStage).toHaveBeenCalledWith(expect.objectContaining({ withheldAmount: 10000, withheldPphType: 'pph4_2' }));
  });

  it('AC-VWH-030 an edited withheld amount survives a type switch', async () => {
    renderVI({ vendorId: 'vendor-1' });
    await userEvent.type(screen.getByTestId('vi-amount-input'), '1000000');
    await userEvent.selectOptions(screen.getByTestId('vi-tax-treatment-select'), 'exclusive');
    const withheld = await screen.findByTestId('vi-withheld-input');
    await waitFor(() => expect(withheld).toHaveValue(formatMoneyInputValue(20000)));
    await userEvent.clear(withheld);
    await userEvent.type(withheld, '19999');
    await userEvent.selectOptions(screen.getByTestId('vi-pph-type-select'), 'pph4_2');
    expect(withheld).toHaveValue(formatMoneyInputValue(19999));
  });

  it('explains why a default withholding cannot be saved before a bill amount is entered', async () => {
    renderVI({ vendorId: 'vendor-1' });
    await userEvent.selectOptions(screen.getByTestId('vi-tax-treatment-select'), 'exclusive');
    expect(await screen.findByText('Enter the bill amount to calculate the vendor withholding.')).toHaveAttribute('role', 'status');
    expect(screen.getByTestId('btn-save-vi')).toBeDisabled();
  });

  it('AC-VWH-030 the withheld error waits for engagement: a pristine form shows none', async () => {
    renderVI({ vendorId: 'vendor-1' });
    await userEvent.selectOptions(screen.getByTestId('vi-tax-treatment-select'), 'exclusive');
    // The vendor's PPh 23 is seeded and its amount field is offered, but nothing has been entered — no error.
    expect(screen.getByTestId('vi-withheld-input')).toBeInTheDocument();
    expect(screen.queryByText(/Enter the tax withheld as an amount no larger than the invoice amount/)).toBeNull();
  });

  it('AC-VWH-030 an incomplete engaged state does show the withheld error', async () => {
    repo.getCompany.mockResolvedValueOnce(NO_DEFAULT);
    renderVI({ vendorId: 'vendor-1' });
    await userEvent.type(screen.getByTestId('vi-amount-input'), '1000000');
    await userEvent.selectOptions(screen.getByTestId('vi-tax-treatment-select'), 'exclusive');
    await userEvent.type(screen.getByTestId('vi-tax-amount-input'), '0');
    await userEvent.selectOptions(screen.getByTestId('vi-pph-type-select'), 'pph23');
    expect(await screen.findByText(/Enter the tax withheld as an amount no larger than the invoice amount/)).toBeInTheDocument();
  });
});

describe('ERP-connected bill (amounts sent as fixed rows) — AC-VWH-031', () => {
  beforeEach(() => { vi.spyOn(ownership, 'routeDomainWrite').mockReturnValue('external'); });

  it('AC-VWH-031 "Enter the tax amounts" is the default; VAT, PPh 23 and its amount are pre-filled on the items total', async () => {
    const onStage = renderVI({ vendorId: 'vendor-1', itemsNet: 1000000 });
    const select = (await screen.findByTestId('vi-tax-template-select')) as HTMLSelectElement;
    expect(select.value).toBe('');
    expect(within(select).getByRole('option', { name: 'Enter the tax amounts' })).toBeInTheDocument();
    expect(within(select).queryByRole('option', { name: 'ERPNext default' })).toBeNull();
    await waitFor(() => expect(screen.getByTestId('vi-erp-vat-input')).toHaveValue(formatMoneyInputValue(110000)));
    expect(screen.getByTestId('vi-pph-type-select')).toHaveValue('pph23');
    await waitFor(() => expect(screen.getByTestId('vi-erp-withheld-input')).toHaveValue(formatMoneyInputValue(20000)));
    expect(screen.getByTestId('vi-items-net')).toHaveTextContent(`Items total, before tax: ${formatMoneyInputValue(1000000)}`);
    // OQ-VWH-8: the bill amount is never sent on this path (ERPNext totals the items), so it is not asked.
    expect(screen.queryByTestId('vi-amount-input')).toBeNull();
    await userEvent.click(screen.getByTestId('btn-save-vi'));
    expect(onStage).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'createVI', erpTaxAmounts: { vatAmount: 110000, withheldAmount: 20000, pphType: 'pph23' },
    }));
    expect(onStage.mock.calls[0][0]).not.toHaveProperty('taxTemplate');
  });

  it('AC-VWH-031 choosing a template hides the amounts and stages only the template', async () => {
    const onStage = renderVI({ vendorId: 'vendor-1', itemsNet: 1000000 });
    const select = await screen.findByTestId('vi-tax-template-select');
    await waitFor(() => expect(within(select).getByRole('option', { name: 'Input VAT 11' })).toBeInTheDocument());
    await userEvent.selectOptions(select, 'Input VAT 11');
    expect(screen.queryByTestId('vi-erp-vat-input')).toBeNull();
    await userEvent.click(screen.getByTestId('btn-save-vi'));
    expect(onStage).toHaveBeenCalledWith(expect.objectContaining({ taxTemplate: 'Input VAT 11' }));
    expect(onStage.mock.calls[0][0]).not.toHaveProperty('erpTaxAmounts');
  });

  it('AC-VWH-031 choosing no withholding hides the PPh amount and stages none', async () => {
    const onStage = renderVI({ vendorId: 'vendor-1', itemsNet: 1000000 });
    await waitFor(() => expect(screen.getByTestId('vi-pph-type-select')).toHaveValue('pph23'));
    await userEvent.selectOptions(screen.getByTestId('vi-pph-type-select'), '');
    expect(screen.queryByTestId('vi-erp-withheld-input')).toBeNull();
    await userEvent.click(screen.getByTestId('btn-save-vi'));
    expect(onStage).toHaveBeenCalledWith(expect.objectContaining({
      erpTaxAmounts: { vatAmount: 110000, withheldAmount: 0, pphType: null },
    }));
  });

  it('AC-VWH-031 without a vendor default the save waits for a VAT amount (0 allowed)', async () => {
    repo.getCompany.mockResolvedValueOnce(NO_DEFAULT);
    const onStage = renderVI({ vendorId: 'vendor-1', itemsNet: 1000000 });
    await screen.findByTestId('vi-erp-vat-input');
    expect(screen.getByTestId('btn-save-vi')).toBeDisabled();
    await userEvent.type(screen.getByTestId('vi-erp-vat-input'), '0');
    await userEvent.click(screen.getByTestId('btn-save-vi'));
    expect(onStage).toHaveBeenCalledWith(expect.objectContaining({
      erpTaxAmounts: { vatAmount: 0, withheldAmount: 0, pphType: null },
    }));
  });

  it('AC-VWH-031 the entered withheld may not exceed the items total (the server refuses it too)', async () => {
    const onStage = renderVI({ vendorId: 'vendor-1', itemsNet: 1000000 });
    const withheld = await screen.findByTestId('vi-erp-withheld-input');
    await waitFor(() => expect(withheld).toHaveValue(formatMoneyInputValue(20000)));
    await userEvent.clear(withheld);
    await userEvent.type(withheld, '1000000.01');
    expect(screen.getByText(/The tax withheld is larger than the items total before tax/)).toBeInTheDocument();
    expect(screen.getByTestId('btn-save-vi')).toBeDisabled();
    expect(onStage).not.toHaveBeenCalled();
    await userEvent.clear(withheld);
    await userEvent.type(withheld, '1000000');
    expect(screen.queryByText(/The tax withheld is larger than the items total before tax/)).toBeNull();
    expect(screen.getByTestId('btn-save-vi')).toBeEnabled();
    await userEvent.click(screen.getByTestId('btn-save-vi'));
    expect(onStage).toHaveBeenCalledWith(expect.objectContaining({ erpTaxAmounts: { vatAmount: 110000, withheldAmount: 1000000, pphType: 'pph23' } }));
  });

  it('AC-VWH-031 the amounts and their bases render in Bahasa Indonesia', async () => {
    await financeTestI18n.changeLanguage('id');
    renderVI({ vendorId: 'vendor-1', itemsNet: 1000000 });
    expect(await screen.findByLabelText('Jumlah PPN')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Masukkan jumlah pajak' })).toBeInTheDocument();
    expect(screen.getByTestId('vi-items-net').textContent).toMatch(/^Total item, sebelum pajak: /);
    await waitFor(() => expect(screen.getAllByTestId('vi-tax-suggested-from')[0].textContent).toMatch(/^Default vendor 11% dari /));
  });
});
