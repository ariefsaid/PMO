import React from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CostLeftOutBlock } from './CostLeftOutBlock';
import type { WorkOrderCostLeftOut } from '@/src/lib/db/workOrderCostLeftOut';

const pricedOnly: WorkOrderCostLeftOut = {
  workOrderId: 'wo-1',
  pricesHidden: false,
  labourCostEnabled: true,
  stockIssueCostEnabled: false,
  items: [
    { kind: 'unpaid_bill', count: 1, currency: 'IDR', total: '1000000.00' },
    { kind: 'uncounted_stock', count: 2, currency: 'IDR', total: '500000.00' },
  ],
};

const mixedWithCountOnly: WorkOrderCostLeftOut = {
  workOrderId: 'wo-1',
  pricesHidden: false,
  labourCostEnabled: false,
  stockIssueCostEnabled: false,
  items: [
    { kind: 'unpaid_bill', count: 1, currency: 'IDR', total: '1000000.00' },
    { kind: 'unapproved_labour', count: 2, currency: null, total: null },
    { kind: 'unrated_labour', count: 1, currency: null, total: null },
    { kind: 'uncounted_stock', count: 1, currency: 'IDR', total: '750000.00' },
  ],
};

describe('CostLeftOutBlock', () => {
  it('renders nothing when all counts are zero', () => {
    const { container } = render(
      <CostLeftOutBlock
        workOrderId="wo-1"
        data={{ workOrderId: 'wo-1', pricesHidden: false, labourCostEnabled: true, stockIssueCostEnabled: true, items: [] }}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('starts collapsed as one line with combined total when every kind has a total in one currency, and expands on click', () => {
    render(<CostLeftOutBlock workOrderId="wo-1" data={pricedOnly} />);
    const toggle = screen.getByTestId('wo-cost-left-out-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle.textContent).toContain('Not yet counted: 3 records');
    expect(toggle.textContent).toMatch(/1,500,000|1\.500\.000/);
    expect(screen.queryByTestId('wo-cost-left-out-list')).toBeNull();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const list = screen.getByTestId('wo-cost-left-out-list');
    expect(list).toBeInTheDocument();
    expect(screen.getByTestId('wo-cost-left-out-item-unpaid_bill').textContent).toContain('1 record');
    expect(screen.getByTestId('wo-cost-left-out-item-uncounted_stock').textContent).toContain('Stock issue costing is off');
  });

  it('omits combined total from collapsed line when any kind is count-only, and shows setting-off notes when expanded', () => {
    render(<CostLeftOutBlock workOrderId="wo-1" data={mixedWithCountOnly} />);
    const toggle = screen.getByTestId('wo-cost-left-out-toggle');
    expect(toggle.textContent).toBe('Not yet counted: 5 records');

    fireEvent.click(toggle);
    expect(screen.getByTestId('wo-cost-left-out-amount-unapproved_labour').textContent).toBe('Count only');
    expect(screen.getByTestId('wo-cost-left-out-item-unrated_labour').textContent).toContain('Labour costing is off');
    expect(screen.getByTestId('wo-cost-left-out-item-uncounted_stock').textContent).toContain('Stock issue costing is off');
  });
});
