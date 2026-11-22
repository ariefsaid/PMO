import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { CostSection } from './CostSection';

const group = (source: string) => ({
  source, totals: [], restricted: false, moneyByRecord: {},
  disciplines: [{ disciplineId: 'none', totals: [], lines: [{ source, recordId: 'r1', reference: 'GR-0001', occurredOn: '2026-12-01', quantity: null, quantityUnit: null }] }],
}) as never;

const renderIt = (source: string) => render(
  <MemoryRouter><CostSection links={{}} labels={{}} groups={[group(source)]} disciplines={[]} isPending={false} isError={false} onRetry={vi.fn()} moneyPending={false} /></MemoryRouter>,
);

describe('JOB-PU22 the work order cost page says what a receipt is still missing', () => {
  it('a goods receipt with no bill says it counts once its supplier bill is recorded, not "amount unavailable"', () => {
    renderIt('goods_receipt');
    expect(screen.getByTestId('cost-commitment-goods_receipt')).toHaveTextContent(/receipt counts once its supplier bill is recorded/);
    expect(screen.queryByText('Amount unavailable')).toBeNull();
  });
  it('a source that is not a purchase commitment keeps its own wording', () => {
    renderIt('vendor_bill');
    expect(screen.getByText('Amount unavailable')).toBeInTheDocument();
  });
});
