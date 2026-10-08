import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  id: 'slip-1', slip_number: 'TAX-2026-1', slip_date: '2026-10-09', tax_period: '2026-10-01',
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
    expect(screen.getAllByText(/IDR.?20,000\.00/)).toHaveLength(2);
    expect(screen.getByText('VI-002')).toBeInTheDocument();
    expect(screen.getByText('Slip change history')).toBeInTheDocument();
    if (overrides.status === 'void') expect(screen.getByText(/Duplicate entry/)).toBeInTheDocument();
    if (overrides.validation_state === 'needs-review') { expect(screen.getByText('Needs review')).toBeInTheDocument(); expect(screen.getByText(/Verify the source/)).toBeInTheDocument(); }
    if (overrides.validation_state === 'reconciled') { expect(screen.getByText('Reconciled')).toBeInTheDocument(); expect(screen.queryByText('Needs review', { selector: 'dt' })).not.toBeInTheDocument(); }
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
    await waitFor(() => expect(state.correct).toHaveBeenCalledWith({ slipId: 'slip-1', expectedRevision: 7, slipNumber: 'TAX-CORRECTED', slipDate: '2026-10-09', taxPeriod: '2026-10-01', reason: 'Corrected transcription' }));
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
