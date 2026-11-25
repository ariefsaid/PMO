import React from 'react';
import { it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
const h = vi.hoisted(() => ({ check: vi.fn(), proof: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { equipmentAvailability: { hourlyRentalCheck: h.check, proofUrl: h.proof } } }));
vi.mock('@/src/hooks/useEquipmentAvailability', () => ({
  useRentalInvoiceChoices: () => ({ data: [{ id: 'invoice', label: 'VI-123' }], isPending: false }),
  useSavedRentalChecks: () => ({ data: [], isPending: false }),
  useRefreshRentalChecks: () => vi.fn().mockResolvedValue(undefined),
}));
import HourlyRentalCheck from './HourlyRentalCheck';
beforeEach(() => vi.clearAllMocks());
it('AC-HRE-004 officer compares hours and records a dispute', async () => {
  h.check.mockResolvedValue({ contracted_hours: '200.00', broken_hours: '40.00', billable_hours: '160.00', invoice_hours: '170.00', rate: '100.00', currency: 'IDR', deduction: '4000.00', expected_amount: '16000.00', state: 'disputed', days: [] });
  render(<HourlyRentalCheck assetId="asset" from="2026-09-01" to="2026-09-30" />);
  await userEvent.type(screen.getByLabelText('Contracted hours'), '200');
  await userEvent.type(screen.getByLabelText('Invoice hours'), '170');
  await userEvent.selectOptions(screen.getByLabelText('Supplier invoice'), 'invoice');
  await userEvent.type(screen.getByLabelText('Officer note'), 'Supplier billed broken hours');
  await userEvent.click(screen.getByRole('button', { name: 'Mark disputed' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Disputed');
  expect(screen.getByText('160.00')).toBeInTheDocument();
  expect(h.check).toHaveBeenCalledWith(expect.objectContaining({ contractedHours: '200', invoiceHours: '170', state: 'disputed' }));
});
it('requires quantities and lets the officer remove a dated breakdown', async () => {
  render(<HourlyRentalCheck assetId="asset" from="2026-09-01" to="2026-09-30" />);
  expect(screen.getByRole('button', { name: 'Mark checked' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Add broken hours' }));
  expect(screen.getByLabelText('Breakdown date')).toHaveValue('1 Sep 2026');
  await userEvent.type(screen.getByLabelText('Broken hours'), '24');
  await userEvent.click(screen.getByRole('button', { name: 'Remove breakdown' }));
  expect(screen.queryByLabelText('Broken hours')).not.toBeInTheDocument();
});
it('shows the server refusal without claiming that the check was saved', async () => {
  h.check.mockRejectedValueOnce(new Error('Rental period is invalid'));
  render(<HourlyRentalCheck assetId="asset" from="2026-09-01" to="2026-09-30" />);
  await userEvent.type(screen.getByLabelText('Contracted hours'), '200');
  await userEvent.type(screen.getByLabelText('Invoice hours'), '160');
  await userEvent.selectOptions(screen.getByLabelText('Supplier invoice'), 'invoice');
  await userEvent.click(screen.getByRole('button', { name: 'Mark checked' }));
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
it('compares dated broken hours without saving and opens their proof', async () => {
  h.check.mockResolvedValueOnce({ contracted_hours: '200.00', broken_hours: '24.00', billable_hours: '176.00', invoice_hours: '176.00', rate: '100.00', currency: 'IDR', deduction: '2400.00', expected_amount: '17600.00', state: null,
    days: [{ date: '2026-09-01', hours: 24, proven: true, proofs: [{ id: 'p', file_name: 'repair.pdf', file_path: 'proof' }] }] });
  h.proof.mockResolvedValueOnce('https://example.test/repair');
  render(<HourlyRentalCheck assetId="asset" from="2026-09-01" to="2026-09-30" />);
  await userEvent.type(screen.getByLabelText('Contracted hours'), '200');
  await userEvent.type(screen.getByLabelText('Invoice hours'), '176');
  await userEvent.click(screen.getByRole('button', { name: 'Add broken hours' }));
  await userEvent.type(screen.getByLabelText('Broken hours'), '24');
  await userEvent.click(screen.getByRole('button', { name: 'Compare hours' }));
  expect(await screen.findAllByText('176.00')).toHaveLength(2);
  expect(h.check).toHaveBeenCalledWith(expect.objectContaining({ state: null, broken: [{ date: '2026-09-01', hours: '24' }] }));
  expect(h.check.mock.calls[0][0].invoiceId).toBeUndefined(); // #2889: no empty invoice id is sent
  await userEvent.click(screen.getByRole('button', { name: 'Open repair.pdf' }));
  expect(await screen.findByRole('link', { name: 'repair.pdf' })).toHaveAttribute('href','https://example.test/repair');
});
