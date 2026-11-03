/**
 * AC-OPP-081 / AC-OPP-080 (FR-OPP-093, FR-OPP-044) — on an Odoo-owned org the bill form offers the taxes of the Odoo directory
 * (never ERPNext's template or amounts) and stages the picked ids; the payment form offers the journals, forwards the chosen one,
 * and will not offer a bill that needs attention.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

const templates = vi.hoisted(() => ({ list: vi.fn(async () => []) }));
vi.mock('@/src/lib/repositories', async (orig) => {
  const actual = (await orig()) as { repositories: Record<string, unknown> };
  return { ...actual, repositories: { ...actual.repositories, integrations: { listPurchaseTaxTemplates: templates.list } } };
});
vi.mock('@/src/hooks/useOrgTaxDefault', async (orig) => ({ ...((await orig()) as Record<string, unknown>), useOrgTaxDefault: () => undefined }));
const dir = vi.hoisted(() => ({
  tax: [{ external_id: '7', name: 'PPN 11%', code: null, attrs: {} }, { external_id: '12', name: 'PPh 23', code: null, attrs: {} }],
  journal: [{ external_id: '9', name: 'Bank BCA', code: null, attrs: { type: 'bank' } }],
}));
vi.mock('@/src/hooks/useOdoo', () => ({
  useMasterRecords: (input: { kind: 'tax' | 'journal' }) => ({ data: { rows: dir[input.kind], total: dir[input.kind].length }, isError: false }),
  useMasterSummary: () => ({ data: { asOf: new Date().toISOString() } }),
}));

import { ToastProvider } from '@/src/components/ui';
import { RecordCaptureForm } from './RecordCaptureForm';
import { queryClient } from '@/src/lib/queryClient';
import { clearOwnershipCache, setTaskOwnership } from '@/src/lib/adapterSeam/ownershipCache';

const odoo = () => setTaskOwnership([{ domain: 'procurement', externalTier: 'odoo' }]);
beforeEach(() => { queryClient.clear(); templates.list.mockClear(); });
afterEach(() => clearOwnershipCache());

describe('bill form on an Odoo-owned org', () => {
  it('offers the Odoo taxes, not ERPNext\'s template or tax amounts, and asks no bill amount', () => {
    odoo();
    render(<ToastProvider><RecordCaptureForm kind="vendor_invoice" onCreate={vi.fn()} onClose={vi.fn()} onStage={vi.fn()} /></ToastProvider>);
    expect(screen.getByRole('group', { name: 'Taxes' })).toBeInTheDocument();
    expect(screen.queryByTestId('vi-tax-template-select')).toBeNull();
    expect(screen.queryByText(/ERPNext/)).toBeNull();
    expect(templates.list).not.toHaveBeenCalled();
  });

  it('stages the picked tax ids with the bill', async () => {
    odoo();
    const onStage = vi.fn();
    render(<ToastProvider><RecordCaptureForm kind="vendor_invoice" onCreate={vi.fn()} onClose={vi.fn()} onStage={onStage} /></ToastProvider>);
    await userEvent.click(screen.getByRole('checkbox', { name: 'PPN 11%' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'PPh 23' }));
    await userEvent.click(screen.getByTestId('btn-save-vi'));
    expect(onStage).toHaveBeenCalledWith(expect.objectContaining({ kind: 'createVI', taxIds: ['7', '12'] }));
  });

  it('with no pick it stages no taxIds, so the organisation default applies', async () => {
    odoo();
    const onStage = vi.fn();
    render(<ToastProvider><RecordCaptureForm kind="vendor_invoice" onCreate={vi.fn()} onClose={vi.fn()} onStage={onStage} /></ToastProvider>);
    await userEvent.click(screen.getByTestId('btn-save-vi'));
    expect(onStage.mock.calls[0][0]).not.toHaveProperty('taxIds');
  });

  it('an ERPNext org is unchanged: no Odoo tax group', () => {
    setTaskOwnership([{ domain: 'procurement', externalTier: 'erpnext' }]);
    render(<ToastProvider><RecordCaptureForm kind="vendor_invoice" onCreate={vi.fn()} onClose={vi.fn()} onStage={vi.fn()} /></ToastProvider>);
    expect(screen.queryByRole('group', { name: 'Taxes' })).toBeNull();
    expect(screen.getByTestId('vi-tax-template-select')).toBeInTheDocument();
  });
});

describe('payment form on an Odoo-owned org', () => {
  const bills = [
    { id: 'inv-1', reference_number: 'INV-1', vi_number: 'VI-1', invoice_date: '2026-01-02', erp_outstanding_amount: 500, erp_attention: null },
    { id: 'inv-2', reference_number: 'INV-2', vi_number: 'VI-2', invoice_date: '2026-01-03', erp_outstanding_amount: 700, erp_attention: 'total-mismatch' },
  ] as never;

  it('forwards the chosen journal with the payment', async () => {
    odoo();
    const onCreate = vi.fn(async () => undefined);
    render(<ToastProvider><RecordCaptureForm kind="payment" onCreate={onCreate} onClose={vi.fn()} invoices={bills} /></ToastProvider>);
    await userEvent.selectOptions(screen.getByTestId('payment-invoice-select'), 'inv-1');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Pay from' }), '9');
    await userEvent.click(screen.getByTestId('payment-save-btn'));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ invoiceId: 'inv-1', journalId: '9' }));
  });

  it('sends no journal when none is chosen (the organisation default)', async () => {
    odoo();
    const onCreate = vi.fn(async (_input: unknown) => undefined);
    render(<ToastProvider><RecordCaptureForm kind="payment" onCreate={onCreate} onClose={vi.fn()} invoices={bills} /></ToastProvider>);
    await userEvent.selectOptions(screen.getByTestId('payment-invoice-select'), 'inv-1');
    await userEvent.click(screen.getByTestId('payment-save-btn'));
    expect(onCreate.mock.calls[0][0]).not.toHaveProperty('journalId');
  });

  it('FR-OPP-044 a bill that needs attention is listed but cannot be chosen, and says to check it in Odoo', () => {
    odoo();
    render(<ToastProvider><RecordCaptureForm kind="payment" onCreate={vi.fn()} onClose={vi.fn()} invoices={bills} /></ToastProvider>);
    const option = screen.getByRole('option', { name: /VI-2.*check in Odoo first/i }) as HTMLOptionElement;
    expect(option.disabled).toBe(true);
    expect((screen.getByRole('option', { name: /VI-1/ }) as HTMLOptionElement).disabled).toBe(false);
  });

  it('a PMO-owned org shows no journal choice', () => {
    clearOwnershipCache();
    render(<ToastProvider><RecordCaptureForm kind="payment" onCreate={vi.fn()} onClose={vi.fn()} invoices={bills} /></ToastProvider>);
    expect(screen.queryByRole('combobox', { name: 'Pay from' })).toBeNull();
  });
});

describe('AC-OPP-080 an action fails honestly while Odoo is unreachable', () => {
  it('the payment form says Odoo is unreachable and that nothing was sent', async () => {
    odoo();
    const onCreate = vi.fn().mockRejectedValue(Object.assign(new Error('The external system could not be reached'), { code: 'external-unreachable' }));
    render(<ToastProvider><RecordCaptureForm kind="payment" onCreate={onCreate} onClose={vi.fn()} invoices={[{ id: 'inv-1', reference_number: 'INV-1', vi_number: 'VI-1', invoice_date: '2026-01-02', erp_outstanding_amount: 500 }] as never} /></ToastProvider>);
    await userEvent.selectOptions(screen.getByTestId('payment-invoice-select'), 'inv-1');
    await userEvent.click(screen.getByTestId('payment-save-btn'));
    expect(await screen.findByText('Odoo is unreachable, try again.')).toBeInTheDocument();
    expect(screen.getByText('Nothing was sent.')).toBeInTheDocument();
    expect(onCreate).toHaveBeenCalledTimes(1);
  });
});
