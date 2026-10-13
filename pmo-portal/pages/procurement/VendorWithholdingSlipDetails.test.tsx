import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FinanceI18nTestProvider } from '../__tests__/financeI18nTestProvider';
import { financeTestI18n, financeTestI18nReady } from '../__tests__/financeI18nTestInstance';

const state = vi.hoisted(() => ({
  detail: { isLoading: false, isError: false, data: null as unknown, refetch: vi.fn() },
  correct: vi.fn(), voidSlip: vi.fn(),
}));
vi.mock('@/src/hooks/useVendorWithholdingSlips', () => ({
  useVendorWithholdingSlip: () => state.detail,
  useVendorWithholdingSlipMutations: () => ({ correct: { mutateAsync: state.correct, isPending: false }, void: { mutateAsync: state.voidSlip, isPending: false } }),
}));
vi.mock('@/src/components/history/RecordHistory', () => ({ RecordHistory: () => <div>Slip change history</div> }));

import { VendorWithholdingSlipDetails } from './VendorWithholdingSlipDetails';

const header = {
  id: 'slip-1', slip_number: 'TAX-2026-1', slip_date: '2020-10-09', tax_period: '2020-10-01',
  pph_type: 'pph23', currency: 'IDR', tax_base: '500000.00', withheld_amount: '20000.00',
  status: 'active', validation_state: 'reconciled', revision: 7, void_reason: null,
};
const detail = (overrides: Record<string, unknown> = {}) => ({ header: { ...header, ...overrides }, bills: [{ invoice_id: 'invoice-1', procurement_id: 'case-2', vi_number: 'VI-002', withheld_at_record: '20000.00', currency: 'IDR' }] });
const renderPanel = (canWrite = true) => render(<VendorWithholdingSlipDetails slipId="slip-1" canWrite={canWrite} onClose={vi.fn()} />);

beforeEach(() => {
  state.detail = { isLoading: false, isError: false, data: detail(), refetch: vi.fn() };
  state.correct.mockReset(); state.correct.mockResolvedValue({ slipId: 'slip-1', revision: 8 });
  state.voidSlip.mockReset(); state.voidSlip.mockResolvedValue({ slipId: 'slip-1', revision: 8 });
});

describe('AC-BUPOT-018 withholding-slip details', () => {
  it.each([
    ['active', { status: 'active', validation_state: 'reconciled' }],
    ['void', { status: 'void', validation_state: 'void', void_reason: 'Duplicate entry' }],
    ['review', { status: 'active', validation_state: 'needs-review' }],
  ])('shows issued facts, linked bill and history for the %s state', (_state, overrides) => {
    state.detail.data = detail(overrides);
    renderPanel();
    expect(screen.getByText('TAX-2026-1')).toBeInTheDocument();
    expect(screen.getByText(/IDR.?500,000\.00/)).toBeInTheDocument();
    expect(screen.queryAllByText(/^(needs-review|reconciled|active|void|pph23)$/i, { selector: 'dd' })).toHaveLength(0);
    if (overrides.status === 'active') expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getAllByText(/IDR.?20,000\.00/)).toHaveLength(2);
    expect(screen.getByText('VI-002')).toBeInTheDocument();
    expect(screen.getByText('Slip change history')).toBeInTheDocument();
    if (overrides.status === 'void') expect(screen.getByText(/Duplicate entry/)).toBeInTheDocument();
    if (overrides.validation_state === 'needs-review') { expect(screen.getByText('Needs review')).toBeInTheDocument(); expect(screen.getByText(/Verify the source/)).toBeInTheDocument(); }
    if (overrides.validation_state === 'reconciled') { expect(screen.getByText('Reconciled')).toBeInTheDocument(); expect(screen.queryByText('Needs review', { selector: 'dt' })).not.toBeInTheDocument(); }
  });

  it('AC-BUPOT-021 focuses the detail heading on arrival and restores the originating button on Close', async () => {
    const scroll = vi.fn();
    HTMLElement.prototype.scrollIntoView = scroll;
    const onClose = vi.fn();
    function Harness() {
      const [open, setOpen] = React.useState(false);
      return <><button onClick={() => setOpen(true)}>Open slip</button>{open && <VendorWithholdingSlipDetails slipId="slip-1" canWrite={false} onClose={() => { onClose(); setOpen(false); }} />}</>;
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open slip' });
    opener.focus();
    fireEvent.click(opener);
    const heading = await screen.findByRole('heading', { name: 'Bukti potong details', level: 2 });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(scroll).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(opener).toHaveFocus());
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('#961 F13 makes Open bill in case at least 44px on phone', () => {
    const onOpenProcurement = vi.fn();
    render(<VendorWithholdingSlipDetails slipId="slip-1" canWrite={false} onClose={vi.fn()} onOpenProcurement={onOpenProcurement} />);
    const open = screen.getByRole('button', { name: 'Open bill VI-002 in case case-2' });
    expect(open.className).toContain('touch-target');
    expect(open.className).toContain('max-[767px]:min-h-11');
    fireEvent.click(open);
    expect(onOpenProcurement).toHaveBeenCalledWith('case-2', 'slip-1', 'invoice-1');
  });

  it('#961 open-case-scroll suppresses detail arrival focus for a targeted bill', async () => {
    const scroll = vi.fn();
    HTMLElement.prototype.scrollIntoView = scroll;
    render(<VendorWithholdingSlipDetails slipId="slip-1" canWrite={false} onClose={vi.fn()} suppressArrivalFocus />);
    const heading = await screen.findByRole('heading', { name: 'Bukti potong details', level: 2 });
    await waitFor(() => expect(heading).not.toHaveFocus());
    expect(scroll).not.toHaveBeenCalled();
  });

  it('#961 F20 retains detail title and Close while loading', () => {
    const onClose = vi.fn();
    state.detail.isLoading = true;
    state.detail.data = null;
    render(<VendorWithholdingSlipDetails slipId="slip-1" canWrite={false} onClose={onClose} />);
    expect(screen.getByRole('heading', { name: 'Bukti potong details' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/Loading bukti potong/);
    const closeButton = screen.getByRole('button', { name: 'Close' });
    expect(closeButton).toBeEnabled();
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('#961 F21 translates void Cancel in English and Bahasa', async () => {
    await financeTestI18nReady;
    await act(async () => { await financeTestI18n.changeLanguage('en'); });
    const { rerender } = render(<FinanceI18nTestProvider><VendorWithholdingSlipDetails slipId="slip-1" canWrite onClose={vi.fn()} /></FinanceI18nTestProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Void PMO entry' }));
    let dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Void PMO entry' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(state.voidSlip).not.toHaveBeenCalled();

    await act(async () => { await financeTestI18n.changeLanguage('id'); });
    rerender(<FinanceI18nTestProvider><VendorWithholdingSlipDetails slipId="slip-1" canWrite onClose={vi.fn()} /></FinanceI18nTestProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Batalkan catatan PMO' }));
    dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByRole('button', { name: 'Batal' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Batalkan catatan PMO' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Batal' }));
    expect(state.voidSlip).not.toHaveBeenCalled();
    await act(async () => { await financeTestI18n.changeLanguage('en'); });
  });

  it('AC-BUPOT-018 exposes recorded/current/difference for a changed bill and its legitimate remedy', () => {
    state.detail.data = { header: { ...header, validation_state: 'needs-review', linked_withheld_at_record: '20000.00', linked_withheld_current: '21000.00', difference: '1000.00' }, bills: [{ invoice_id: 'invoice-1', procurement_id: 'case-2', vi_number: 'VI-002', withheld_at_record: '20000.00', withheld_current: '21000.00', difference: '1000.00', currency: 'IDR' }] };
    renderPanel();
    expect(screen.getByText('Bill withholding changed. Verify the source; void and record a replacement if needed.')).toBeInTheDocument();
    expect(screen.getAllByText('Current')[0].parentElement).toHaveTextContent(/IDR.?21,000\.00/);
    expect(screen.getAllByText('Difference')[0].parentElement).toHaveTextContent(/IDR.?1,000\.00/);
    expect(screen.queryByRole('button', { name: 'Correct metadata' })).not.toBeInTheDocument();
  });

  it('shows unavailable with an actionable Reload rather than fabricated facts', () => {
    state.detail.data = null; state.detail.isError = true;
    renderPanel();
    expect(screen.getByRole('alert')).toHaveTextContent('Bukti potong unavailable');
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(screen.queryByText('IDR 0.00')).not.toBeInTheDocument();
  });

  it('submits metadata correction with the displayed revision and entered reason', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Correct metadata' }));
    fireEvent.change(screen.getByLabelText(/Issued slip number/), { target: { value: 'TAX-CORRECTED' } });
    fireEvent.change(screen.getByLabelText(/Correction reason/), { target: { value: 'Corrected transcription' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(state.correct).toHaveBeenCalledWith({ slipId: 'slip-1', expectedRevision: 7, slipNumber: 'TAX-CORRECTED', slipDate: '2020-10-09', taxPeriod: '2020-10-01', reason: 'Corrected transcription' }));
  });

  it('AC-BUPOT-018 prevents future slip dates and tax periods during metadata correction', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Correct metadata' }));
    await screen.findByLabelText(/Issued slip number/);
    const dialog = screen.getByRole('dialog', { name: 'Correct metadata' });
    fireEvent.change(dialog.querySelector('input[type="date"]')!, { target: { value: '2099-01-02' } });
    const futureMonth = dialog.querySelector('input[type="month"]')!;
    fireEvent.change(futureMonth, { target: { value: '2099-01' } });
    fireEvent.blur(futureMonth);
    expect(screen.getByText('Choose a tax month no later than the current month.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(state.correct).not.toHaveBeenCalled();
  });

  it('requires confirmation and a reason before voiding; copy does not claim the tax-office document is cancelled', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Void PMO entry' }));
    expect(state.voidSlip).not.toHaveBeenCalled();
    expect(screen.getByText(/does not cancel a DJP document/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Duplicate PMO evidence' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Void PMO entry' }).at(-1)!);
    await waitFor(() => expect(state.voidSlip).toHaveBeenCalledWith({ slipId: 'slip-1', expectedRevision: 7, reason: 'Duplicate PMO evidence' }));
  });

  it('maps an invalid-facts refusal to an edit remedy and preserves the draft', async () => {
    state.correct.mockRejectedValueOnce({ code: '23514', details: 'bupot-invalid-facts' });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Correct metadata' }));
    fireEvent.change(screen.getByLabelText(/Issued slip number/), { target: { value: 'TAX-DRAFT' } });
    fireEvent.change(screen.getByLabelText(/Correction reason/), { target: { value: 'Fix facts' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findAllByText('Review the entered facts and try again.')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Reload' })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Issued slip number/)).toHaveValue('TAX-DRAFT');
  });

  it('offers Reload when correction is refused as stale', async () => {
    state.correct.mockRejectedValueOnce({ code: '40001', details: 'bupot-stale' });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Correct metadata' }));
    fireEvent.change(screen.getByLabelText(/Correction reason/), { target: { value: 'Fix typo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('This slip changed. Reload it before saving.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });

  it.each(['Engineer', 'Project Manager', 'Executive'] as const)('keeps correction and void actions hidden for read-only %s viewers', () => {
    render(<VendorWithholdingSlipDetails slipId="slip-1" canWrite={false} onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Correct metadata' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Void PMO entry' })).not.toBeInTheDocument();
  });
});
