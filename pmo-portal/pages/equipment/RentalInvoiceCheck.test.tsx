import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({ reset: vi.fn(), mutate: vi.fn(), proofUrl: vi.fn(), unproven: false }));
vi.mock('@/src/hooks/useEquipmentAvailability', () => ({ useRentalCheck: () => ({
  data: { rental_amount: '30000.00', deduction: '3000.00', expected_amount: '27000.00', difference: '500.00', currency: 'IDR', unproven_days: h.unproven ? ['2026-09-22'] : [], included_unproven_reason: null,
    days: [{ date: '2026-09-21', status: 'broken', proven: true, deducted: true, proofs: [{ id: 'p1', file_name: 'ticket.pdf', file_path: 'org/a/p/ticket.pdf' }] }] },
  mutateAsync: h.mutate, reset: h.reset, isPending: false,
}) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { equipmentAvailability: { proofUrl: h.proofUrl } } }));
import RentalInvoiceCheck from './RentalInvoiceCheck';

beforeEach(() => { vi.clearAllMocks(); h.unproven = false; h.proofUrl.mockResolvedValue('https://example.test/proof'); h.mutate.mockResolvedValue(undefined); });
const renderCheck = () => render(<RentalInvoiceCheck assets={[{ id: 'a', code: 'EQU-1', name: 'Machine' }]} today="2026-09-30" monthFrom="2026-09-01" statusLabel={() => 'Broken'} />);

describe('rental invoice check', () => {
  it('AC-EAV-014 displays the actual RPC amounts and lets Finance open the supporting proof', async () => {
    renderCheck();
    expect(screen.getByText('30000.00 IDR')).toBeInTheDocument();
    expect(screen.getByText('3000.00')).toBeInTheDocument();
    expect(screen.getByText('27000.00')).toBeInTheDocument();
    expect(screen.getByText('500.00')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open ticket.pdf' }));
    expect(await screen.findByRole('link', { name: 'ticket.pdf' })).toHaveAttribute('href', 'https://example.test/proof');
    expect(h.proofUrl).toHaveBeenCalledWith('org/a/p/ticket.pdf');
  });
  it('clears the old comparison when a user changes its inputs', async () => {
    renderCheck();
    await userEvent.type(screen.getByLabelText('Vendor invoice amount'), '42');
    expect(h.reset).toHaveBeenCalled();
  });
  it('requires a reason before including unproven downtime', async () => {
    h.unproven = true; renderCheck();
    await userEvent.selectOptions(screen.getByLabelText('Rented machine'), 'a');
    const include = screen.getByRole('button', { name: 'Include unproven days' });
    expect(include).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Reason to include unproven days'), 'Vendor confirmed');
    await userEvent.click(include);
    expect(h.mutate).toHaveBeenCalledWith({ assetId: 'a', from: '2026-09-01', to: '2026-09-30', invoice: '', reason: 'Vendor confirmed' });
  });
  it('reports failure to open a proof', async () => {
    h.proofUrl.mockRejectedValueOnce(new Error('Proof unavailable'));
    renderCheck();
    await userEvent.click(screen.getByRole('button', { name: 'Open ticket.pdf' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('clears the selected invoice when the equipment page changes', async () => {
    const view = renderCheck();
    await userEvent.selectOptions(screen.getByLabelText('Rented machine'), 'a');
    h.reset.mockClear();
    view.rerender(<RentalInvoiceCheck assets={[{ id: 'b', code: 'EQU-2', name: 'Other' }]} today="2026-09-30" monthFrom="2026-09-01" statusLabel={() => 'Broken'} />);
    expect(h.reset).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Check invoice' })).toBeDisabled();
  });

});
