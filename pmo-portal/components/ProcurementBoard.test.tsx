import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router';
import ProcurementBoard from './ProcurementBoard';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';

const row = (over: Partial<ProcurementWithRefs>): ProcurementWithRefs =>
  ({
    id: 'p1',
    code: 'PR-2606040001',
    title: 'Structural steel',
    status: 'Ordered',
    total_value: 842000,
    currency: 'USD',
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
  it('renders all six lifecycle stage columns (no Approved column — approval is a gate)', () => {
    // Owner directive 2026-06-21: approval is a gate, not a stage → no Approved column.
    render(<ProcurementBoard procurements={[]} onOpen={vi.fn()} />);
    for (const full of ['Purchase Request', 'Vendor Quote', 'Purchase Order', 'Goods Receipt', 'Vendor Invoice', 'Payment']) {
      expect(screen.getByText(full)).toBeInTheDocument();
    }
    expect(screen.queryByText('Approved')).not.toBeInTheDocument();
  });

  it('an approved request appears in the Vendor Quote column (the bar advanced on approval)', () => {
    render(
      <MemoryRouter>
        <ProcurementBoard procurements={[row({ status: 'Approved', title: 'Approved req' })]} onOpen={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('prstage-vq')).toHaveTextContent('Approved req');
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
    // one column-head dot per stage (6 stages: pr, vq, po, gr, vi, paid)
    expect(dots).toHaveLength(6);
    const backgrounds = dots.map((d) => d.style.background);
    // the five upstream stages (pr, vq, po, gr, vi) are quiet neutral
    expect(backgrounds.slice(0, 5)).toEqual(
      Array(5).fill('hsl(var(--muted-foreground))'),
    );
    // the terminal Payment stage is success
    expect(backgrounds[5]).toBe('hsl(var(--success))');
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

  it('FR-L10N-020: a card and its column total render in the RECORD currency, not USD', () => {
    render(
      <MemoryRouter>
        <ProcurementBoard
          procurements={[row({ status: 'Ordered', currency: 'EUR', total_value: 1000 })]}
          onOpen={vi.fn()}
        />
      </MemoryRouter>,
    );
    const poCol = screen.getByTestId('prstage-po');
    expect(poCol).toHaveTextContent('€1,000');
    expect(poCol).not.toHaveTextContent('$1,000');
  });

  /**
   * DD-CUR-6 (#530 item 3): a mixed-currency stage total is a PER-CURRENCY BREAKDOWN.
   *
   * ⛔ What this pins is not cosmetic. The previous code summed ACROSS currencies and labelled the
   * result with `items[0].currency` — so an IDR request behind a USD one produced a number that is
   * not any real quantity, rendered with the confidence of one. The single-currency test above
   * could never see it: with one currency in the column, first-row-label and per-currency-breakdown
   * are indistinguishable. It takes two.
   */
  describe('DD-CUR-6: a stage holding two currencies breaks the total down', () => {
    it('AC-L10N-030: renders one exact subtotal per currency, and never their sum', () => {
      render(
        <MemoryRouter>
          <ProcurementBoard
            procurements={[
              row({ id: 'p-usd', status: 'Ordered', currency: 'USD', total_value: 1000 }),
              row({ id: 'p-idr', status: 'Ordered', currency: 'IDR', total_value: 2000 }),
            ]}
            onOpen={vi.fn()}
          />
        </MemoryRouter>,
      );
      const totals = screen.getByTestId('prstage-po-totals');
      expect(totals.children).toHaveLength(2);
      expect(totals.textContent).toContain('$1,000');
      // ⚑ Intl en-US separates a code-style currency from its amount with U+00A0 (NBSP), never a
      // plain space — asserting 'IDR 2,000' with an ordinary space silently never matches.
      expect(totals.textContent).toContain('IDR\u00a02,000');
      // The cross-currency sum is the thing that must NOT appear: 1000 + 2000 is not a quantity.
      expect(totals.textContent).not.toContain('3,000');
    });

    it('AC-L10N-031: a single-currency stage still renders exactly one line — the breakdown degrades', () => {
      render(
        <MemoryRouter>
          <ProcurementBoard
            procurements={[
              row({ id: 'p-a', status: 'Ordered', currency: 'USD', total_value: 1000 }),
              row({ id: 'p-b', status: 'Ordered', currency: 'USD', total_value: 500 }),
            ]}
            onOpen={vi.fn()}
          />
        </MemoryRouter>,
      );
      // Scoped to the TOTALS region: the cards themselves legitimately render $1,000 and $500,
      // so a column-wide assertion cannot tell one subtotal line from two.
      const totals = screen.getByTestId('prstage-po-totals');
      expect(totals.textContent).toBe('$1,500');
      // Same-currency rows still SUM — a breakdown that refused to add would be a regression.
      expect(totals.children).toHaveLength(1);
    });
  });
});
