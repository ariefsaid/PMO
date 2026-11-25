import React from 'react';
import { it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const h = vi.hoisted(() => ({ rows: [] as unknown[], pending: false }));
vi.mock('@/src/hooks/useEquipmentAvailability', () => ({ useSavedRentalChecks: () => ({ data: h.rows, isPending: h.pending, isError: false }) }));
import RentalCheckHistory from './RentalCheckHistory';
it('AC-HRE-005 Finance sees the saved invoice dispute and officer note', () => {
  h.rows = [{ id: 'check', state: 'disputed', note: 'Supplier billed the broken hours', invoice_number: 'VI-123', period_from: '2026-09-01', period_to: '2026-09-30', created_at: '2026-10-01T00:00:00Z', author: 'Equipment Officer' }];
  render(<RentalCheckHistory procurementId="purchase" />);
  expect(screen.getByRole('alert')).toHaveTextContent('Supplier billed the broken hours');
  expect(screen.getByRole('alert')).toHaveTextContent('VI-123');
  expect(screen.getByText(/does not change approval rights or amounts/)).toBeInTheDocument();
});
it('waits for an asset selection without displaying an endless loading message', () => {
  h.pending = true;
  render(<RentalCheckHistory />);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  h.pending = false;
});
