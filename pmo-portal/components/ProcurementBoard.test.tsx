import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import ProcurementBoard from './ProcurementBoard';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';

const row = (over: Partial<ProcurementWithRefs>): ProcurementWithRefs =>
  ({
    id: 'p1',
    code: 'PR-2606040001',
    title: 'Structural steel',
    status: 'Ordered',
    total_value: 842000,
    project_id: 'pr1',
    requested_by_id: 'u1',
    vendor_id: null,
    created_at: '2026-02-05T00:00:00Z',
    project: { name: 'Eastfield Phase 2', code: 'PRJ-001' },
    vendor: null,
    requested_by: { full_name: 'Desmond Achebe' },
    ...over,
  }) as ProcurementWithRefs;

describe('ProcurementBoard — by-stage kanban (Issue 3)', () => {
  it('renders all six lifecycle stage columns', () => {
    render(<ProcurementBoard procurements={[]} onOpen={vi.fn()} />);
    for (const full of ['Purchase Request', 'Vendor Quote', 'Purchase Order', 'Goods Receipt', 'Vendor Invoice', 'Payment']) {
      expect(screen.getByText(full)).toBeInTheDocument();
    }
  });

  it('groups a request into its stage column (Ordered → Purchase Order)', () => {
    render(<ProcurementBoard procurements={[row({ status: 'Ordered' })]} onOpen={vi.fn()} />);
    const poCol = screen.getByTestId('prstage-po');
    expect(poCol).toHaveTextContent('Structural steel');
    expect(poCol).toHaveTextContent('PR-2606040001');
  });

  it('shows the empty message for a stage with no requests', () => {
    render(<ProcurementBoard procurements={[]} onOpen={vi.fn()} />);
    expect(screen.getByText('No requests at Vendor Quote')).toBeInTheDocument();
  });

  it('activating a card calls onOpen with the request', async () => {
    const onOpen = vi.fn();
    render(<ProcurementBoard procurements={[row({ status: 'Ordered' })]} onOpen={onOpen} />);
    await userEvent.click(screen.getByRole('button', { name: /Open Structural steel/i }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0].id).toBe('p1');
  });

  it('excludes terminal off-track (Rejected/Cancelled) requests from the board', () => {
    render(
      <ProcurementBoard
        procurements={[row({ id: 'pr-x', title: 'Rejected req', status: 'Rejected' })]}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.queryByText('Rejected req')).not.toBeInTheDocument();
  });
});
