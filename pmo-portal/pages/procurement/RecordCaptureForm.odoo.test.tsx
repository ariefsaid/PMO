/**
 * AC-OPP-081 / AC-OPP-080 (FR-OPP-093, FR-OPP-044) — on an Odoo-owned org the bill form offers the taxes of the Odoo directory
 * (never ERPNext's template or amounts) and stages the picked ids; the payment form offers the journals, forwards the chosen one,
 * and will not offer a bill that needs attention.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

// AC-PLN-008 (#1783 item 1, D17): the quantity grid is a Full affordance. This suite owns the
// org-feature read with a controllable fixture so each test can move the entitlement between
// ready / loading / error / off and prove the partial-intent state machine on the REAL form.
const orgFeatures = vi.hoisted(() => ({
  state: {
    data: { procurement_full: true } as Partial<Record<string, unknown>> | undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
}));
vi.mock('@/src/hooks/useOrgFeatures', () => ({
  useOrgFeatures: () => orgFeatures.state,
}));

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
const featuresReady = () => { orgFeatures.state = { data: { procurement_full: true }, isLoading: false, isError: false, refetch: vi.fn() }; };
const featuresOff = () => { orgFeatures.state = { data: { procurement_full: false }, isLoading: false, isError: false, refetch: vi.fn() }; };
const featuresLoading = () => { orgFeatures.state = { data: undefined, isLoading: true, isError: false, refetch: vi.fn() }; };
const featuresError = () => { orgFeatures.state = { data: undefined, isLoading: false, isError: true, refetch: vi.fn() }; };
beforeEach(() => { queryClient.clear(); templates.list.mockClear(); featuresReady(); });
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

describe('RecordCaptureForm staging is limited to goods receipts and supplier invoices', () => {
  it('creates a purchase order even if the parent also supplies a staging callback', async () => {
    odoo();
    const onCreate = vi.fn().mockResolvedValue({ id: 'po-new' });
    const onStage = vi.fn();
    render(<ToastProvider><RecordCaptureForm kind="purchase_order" onCreate={onCreate} onClose={vi.fn()} onStage={onStage} /></ToastProvider>);
    await userEvent.type(screen.getByTestId('purchase_order-ref-input'), 'PO-090');
    await userEvent.type(screen.getByTestId('purchase_order-amount-input'), '1000');
    await userEvent.click(screen.getByTestId('purchase_order-save-btn'));

    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ referenceNumber: 'PO-090', amount: 1000 }));
    expect(onStage).not.toHaveBeenCalled();
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
    const formError = await screen.findByTestId('record-capture-error');
    expect(formError).toHaveTextContent('Odoo is unreachable, try again.');
    expect(formError).toHaveTextContent('Nothing was sent.');
    expect(onCreate).toHaveBeenCalledTimes(1);
  });
});

describe('record capture refuses without hiding the recovery path', () => {
  it('F2-18 keeps a classified direct-capture refusal with the entered values until retry', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('permission denied'), { code: '42501' }))
      .mockResolvedValueOnce({ id: 'po-new' });
    const onClose = vi.fn();
    render(<ToastProvider><RecordCaptureForm kind="purchase_order" onCreate={onCreate} onClose={onClose} /></ToastProvider>);

    await user.type(screen.getByTestId('purchase_order-ref-input'), 'PO-090');
    await user.type(screen.getByTestId('purchase_order-amount-input'), '1000');
    await user.click(screen.getByTestId('purchase_order-save-btn'));

    const form = screen.getByTestId('form-capture-purchase_order');
    const error = await within(form).findByRole('alert');
    expect(error).toHaveTextContent("You don't have permission to do that.");
    expect(within(form).getByTestId('purchase_order-ref-input')).toHaveValue('PO-090');
    expect(within(form).getByTestId('purchase_order-amount-input')).toHaveValue('1,000');
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('purchase_order-save-btn'));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(2));
    expect(onCreate.mock.calls[1][0]).toEqual(expect.objectContaining({ referenceNumber: 'PO-090', amount: 1000 }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('F2-05 asks before closing a changed capture and Stay keeps its amount and reference', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ToastProvider><RecordCaptureForm kind="purchase_order" onCreate={vi.fn()} onClose={onClose} /></ToastProvider>);

    await user.type(screen.getByTestId('purchase_order-ref-input'), 'PO-KEEP');
    await user.type(screen.getByTestId('purchase_order-amount-input'), '250');
    const form = screen.getByTestId('form-capture-purchase_order');
    await user.click(within(form).getByRole('button', { name: /cancel/i }));

    const discardDialog = await screen.findByRole('dialog', { name: 'Discard your changes?' });
    expect(onClose).not.toHaveBeenCalled();
    await user.click(within(discardDialog).getByRole('button', { name: 'Stay' }));

    expect(screen.getByTestId('purchase_order-ref-input')).toHaveValue('PO-KEEP');
    expect(screen.getByTestId('purchase_order-amount-input')).toHaveValue('250');
    expect(onClose).not.toHaveBeenCalled();

    await user.click(within(form).getByRole('button', { name: /cancel/i }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Discard your changes?' })).getByRole('button', { name: 'Discard' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('AC-OPP-030/031 goods receipt form on an Odoo-owned org', () => {
  const items = [{ name: 'Pump', quantity: 10 }, { name: 'Valve', quantity: 4 }];
  const form = (onStage = vi.fn()) => render(<ToastProvider><RecordCaptureForm kind="goods_receipt" items={items} onCreate={vi.fn()} onClose={vi.fn()} onStage={onStage} /></ToastProvider>);

  it('asks for a quantity per line and stages only the lines the user filled', async () => {
    odoo();
    const onStage = vi.fn();
    form(onStage);
    await userEvent.type(screen.getByRole('spinbutton', { name: /Pump/ }), '6');
    expect(screen.queryByTestId('gr-status-select')).toBeNull(); // Odoo derives Partial/Complete from what it booked
    await userEvent.click(screen.getByTestId('btn-save-gr'));
    expect(onStage).toHaveBeenCalledWith(expect.objectContaining({ kind: 'createGR', receiptLines: [{ itemRef: 'Pump', quantity: 6 }] }));
  });

  it('with nothing entered it stages no lines, so everything still open is received', async () => {
    odoo();
    const onStage = vi.fn();
    form(onStage);
    await userEvent.click(screen.getByTestId('btn-save-gr'));
    expect(onStage.mock.calls[0][0]).not.toHaveProperty('receiptLines');
  });

  it('a quantity above what was ordered is refused before anything is staged', async () => {
    odoo();
    const onStage = vi.fn();
    form(onStage);
    await userEvent.type(screen.getByRole('spinbutton', { name: /Valve/ }), '5');
    await userEvent.click(screen.getByTestId('btn-save-gr'));
    expect(onStage).not.toHaveBeenCalled();
    expect(screen.getByText(/no more than was ordered for Valve/)).toBeInTheDocument();
  });

  it('an ERPNext org is unchanged: no quantity fields', () => {
    setTaskOwnership([{ domain: 'procurement', externalTier: 'erpnext' }]);
    form();
    expect(screen.queryByRole('spinbutton', { name: /Pump/ })).toBeNull();
  });
});

describe('AC-PLN-008 (#1783 item 1) partial receipt intent survives feature transitions safely', () => {
  const items = [{ name: 'Pump', quantity: 10 }, { name: 'Valve', quantity: 4 }];
  const form = (onStage = vi.fn(), onCreate = vi.fn(async () => undefined)) =>
    render(<ToastProvider><RecordCaptureForm kind="goods_receipt" items={items} onCreate={onCreate} onClose={vi.fn()} onStage={onStage} /></ToastProvider>);

  it('with no draft, Full unavailable keeps the whole-receipt form: status select, no grid, stages no lines', async () => {
    odoo();
    featuresOff();
    const onStage = vi.fn();
    form(onStage);
    expect(screen.queryByRole('spinbutton', { name: /Pump/ })).toBeNull();
    expect(screen.getByTestId('gr-status-select')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('btn-save-gr'));
    expect(onStage.mock.calls[0][0]).not.toHaveProperty('receiptLines');
  });

  it('a typed quantity survives the feature turning off: kept visible, staging blocked, nothing silently received', async () => {
    odoo();
    const onStage = vi.fn();
    const onCreate = vi.fn(async () => undefined);
    const view = form(onStage, onCreate);
    const input = screen.getByRole('spinbutton', { name: /Pump/ }) as HTMLInputElement;
    await userEvent.type(input, '6');
    featuresOff();
    view.rerender(<ToastProvider><RecordCaptureForm kind="goods_receipt" items={items} onCreate={onCreate} onClose={vi.fn()} onStage={onStage} /></ToastProvider>);
    expect((screen.getByRole('spinbutton', { name: /Pump/ }) as HTMLInputElement).value).toBe('6');
    expect(screen.getByTestId('btn-save-gr')).toBeDisabled();
    // The submit-time guard, not just the disabled button: a programmatic submit (Enter key) stages nothing.
    fireEvent.submit(screen.getByTestId('form-create-gr'));
    expect(onStage).not.toHaveBeenCalled();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('the blocked state explains itself and offers retry and an explicit clear; clearing resumes the whole receipt', async () => {
    odoo();
    const onStage = vi.fn();
    const view = form(onStage);
    await userEvent.type(screen.getByRole('spinbutton', { name: /Pump/ }), '6');
    featuresOff();
    view.rerender(<ToastProvider><RecordCaptureForm kind="goods_receipt" items={items} onCreate={vi.fn()} onClose={vi.fn()} onStage={onStage} /></ToastProvider>);
    // The ToastProvider keeps an sr-only status live region, so the query is scoped to the form.
    const statusRegion = within(screen.getByTestId('form-create-gr')).getByRole('status');
    expect(statusRegion).toHaveTextContent(/cannot be submitted/i);
    expect(statusRegion).toHaveTextContent(/receive all open items|Clear quantities/i);

    await userEvent.click(screen.getByTestId('gr-full-retry'));
    expect(orgFeatures.state.refetch).toHaveBeenCalled();

    // An explicit clear is the intent to switch to the whole receipt — only then can it stage.
    await userEvent.click(screen.getByTestId('gr-clear-quantities'));
    expect(screen.queryByRole('spinbutton', { name: /Pump/ })).toBeNull();
    expect(screen.getByTestId('gr-status-select')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('btn-save-gr'));
    expect(onStage.mock.calls[0][0]).not.toHaveProperty('receiptLines');
  });

  it('loading and error with a draft keep the grid and block staging too; Full restored stages the kept quantity', async () => {
    odoo();
    const onStage = vi.fn();
    const first = form(onStage);
    await userEvent.type(screen.getByRole('spinbutton', { name: /Pump/ }), '6');
    featuresLoading();
    first.rerender(<ToastProvider><RecordCaptureForm kind="goods_receipt" items={items} onCreate={vi.fn()} onClose={vi.fn()} onStage={onStage} /></ToastProvider>);
    expect(screen.getByRole('spinbutton', { name: /Pump/ })).toBeInTheDocument();
    expect(screen.getByTestId('btn-save-gr')).toBeDisabled();
    featuresError();
    first.rerender(<ToastProvider><RecordCaptureForm kind="goods_receipt" items={items} onCreate={vi.fn()} onClose={vi.fn()} onStage={onStage} /></ToastProvider>);
    expect(screen.getByTestId('gr-full-retry')).toBeInTheDocument();
    expect(screen.getByTestId('btn-save-gr')).toBeDisabled();
    featuresReady();
    first.rerender(<ToastProvider><RecordCaptureForm kind="goods_receipt" items={items} onCreate={vi.fn()} onClose={vi.fn()} onStage={onStage} /></ToastProvider>);
    expect(screen.queryByTestId('gr-full-retry')).toBeNull();
    await userEvent.click(screen.getByTestId('btn-save-gr'));
    expect(onStage).toHaveBeenCalledWith(expect.objectContaining({ receiptLines: [{ itemRef: 'Pump', quantity: 6 }] }));
  });

  it('an invalid non-blank draft blocks the same way; whitespace-only input is not a draft', async () => {
    odoo();
    const onStage = vi.fn();
    const first = form(onStage);
    await userEvent.type(screen.getByRole('spinbutton', { name: /Valve/ }), '99');
    featuresOff();
    first.rerender(<ToastProvider><RecordCaptureForm kind="goods_receipt" items={items} onCreate={vi.fn()} onClose={vi.fn()} onStage={onStage} /></ToastProvider>);
    expect(screen.getByTestId('btn-save-gr')).toBeDisabled();
    fireEvent.submit(screen.getByTestId('form-create-gr'));
    expect(onStage).not.toHaveBeenCalled();
  });

  it('a blank entry is not a draft: Full off keeps the whole-receipt form and the whole receipt can stage', async () => {
    odoo();
    featuresReady();
    const onStage = vi.fn();
    const view = form(onStage);
    await userEvent.type(screen.getByRole('spinbutton', { name: /Valve/ }), '2');
    // A number input cannot carry whitespace, so the blank-draft journey is: type, then empty the line.
    // The state keeps the blank value; `.trim() !== ''` decides it is not a draft (same guard for
    // whitespace/pasted blanks, which the DOM coerces to '').
    await userEvent.clear(screen.getByRole('spinbutton', { name: /Valve/ }));
    featuresOff();
    view.rerender(<ToastProvider><RecordCaptureForm kind="goods_receipt" items={items} onCreate={vi.fn()} onClose={vi.fn()} onStage={onStage} /></ToastProvider>);
    expect(screen.queryByRole('spinbutton', { name: /Pump/ })).toBeNull();
    expect(screen.getByTestId('gr-status-select')).toBeInTheDocument();
    expect(screen.getByTestId('btn-save-gr')).toBeEnabled();
    await userEvent.click(screen.getByTestId('btn-save-gr'));
    expect(onStage.mock.calls[0][0]).not.toHaveProperty('receiptLines');
  });
});
