import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VendorWithholdingSlipCell } from './VendorWithholdingSlipCell';
import type { BillRow } from '@/src/lib/db/vendorWithholdingSlips';
const bill = (coverage_state: string, active_slip_id: string | null = null) => ({ coverage_state, active_slip_id, slip_number: 'BUPOT/TEST', slip_date: '2026-10-01' } as BillRow);

describe('AC-BUPOT-016 withholding slip cell', () => {
  it('renders explicit loading/error states and retries failures rather than implying absence', () => {
    const retry = vi.fn();
    const { rerender } = render(<VendorWithholdingSlipCell isLoading />);
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
    rerender(<VendorWithholdingSlipCell isError onRetry={retry} />);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.queryByText(/not recorded/i)).not.toBeInTheDocument();
  });
  it('renders active slip facts and never offers record on covered state', () => {
    const record = vi.fn();
    render(<VendorWithholdingSlipCell row={bill('slipped', 'slip-id')} canWrite onRecord={record} onView={vi.fn()} />);
    expect(screen.getByText('BUPOT/TEST')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /view bukti potong/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /record bukti potong/i })).not.toBeInTheDocument();
  });
  it('offers record only for explicitly uncovered bills and preserves exception labels', () => {
    const record = vi.fn();
    render(<VendorWithholdingSlipCell row={bill('not-recorded')} canWrite onRecord={record} />);
    fireEvent.click(screen.getByRole('button', { name: /record bukti potong/i }));
    expect(record).toHaveBeenCalledOnce();
    expect(screen.getByText(/not recorded/i)).toBeInTheDocument();
  });
});
