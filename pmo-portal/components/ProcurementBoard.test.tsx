import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
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
  it('renders all seven lifecycle stage columns (Approved is its own node)', () => {
    // Wave-1 Area-5 (PROC-002): Approved advances the visible stage → its own column.
    render(<ProcurementBoard procurements={[]} onOpen={vi.fn()} />);
    for (const full of ['Purchase Request', 'Approved', 'Vendor Quote', 'Purchase Order', 'Goods Receipt', 'Vendor Invoice', 'Payment']) {
      expect(screen.getByText(full)).toBeInTheDocument();
    }
  });

  it('groups a request into its stage column (Ordered → Purchase Order)', () => {
    render(
      <MemoryRouter>
        <ProcurementBoard procurements={[row({ status: 'Ordered' })]} onOpen={vi.fn()} />
      </MemoryRouter>,
    );
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
    render(
      <MemoryRouter>
        <ProcurementBoard procurements={[row({ status: 'Ordered' })]} onOpen={onOpen} />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: /Open Structural steel/i }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0].id).toBe('p1');
  });

  it('I2: column dots follow ONE convention — neutral upstream, success terminal, no blue column', () => {
    const { container } = render(<ProcurementBoard procurements={[]} onOpen={vi.fn()} />);
    const dots = Array.from(
      container.querySelectorAll<HTMLElement>('span.size-\\[9px\\].rounded-full'),
    );
    // one column-head dot per stage (7 stages: pr, approved, vq, po, gr, vi, paid)
    expect(dots).toHaveLength(7);
    const backgrounds = dots.map((d) => d.style.background);
    // the six upstream stages (pr, approved, vq, po, gr, vi) are quiet neutral
    expect(backgrounds.slice(0, 6)).toEqual(
      Array(6).fill('hsl(var(--muted-foreground))'),
    );
    // the terminal Payment stage is success
    expect(backgrounds[6]).toBe('hsl(var(--success))');
    // no blue/primary column dot remains (matches the sales board convention)
    expect(backgrounds.some((b) => b.includes('--primary'))).toBe(false);
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
