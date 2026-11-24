import React from 'react';
import { it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
const h = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { equipmentAvailability: { hourlyRentalCheck: h.check, proofUrl: vi.fn() } } }));
import HourlyRentalCheck from './HourlyRentalCheck';
it('AC-HRE-004 officer compares hours and records a dispute', async () => {
  h.check.mockResolvedValue({ contracted_hours: '200.00', broken_hours: '40.00', billable_hours: '160.00', invoice_hours: '170.00', rate: '100.00', currency: 'IDR', deduction: '4000.00', expected_amount: '16000.00', state: 'disputed', days: [] });
  render(<HourlyRentalCheck assetId="asset" from="2026-09-01" to="2026-09-30" />);
  await userEvent.type(screen.getByLabelText('Contracted hours'), '200');
  await userEvent.type(screen.getByLabelText('Invoice hours'), '170');
  await userEvent.click(screen.getByRole('button', { name: 'Mark disputed' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Disputed');
  expect(screen.getByText('160.00')).toBeInTheDocument();
  expect(h.check).toHaveBeenCalledWith(expect.objectContaining({ contractedHours: '200', invoiceHours: '170', state: 'disputed' }));
});
