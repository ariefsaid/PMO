import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MissingStep } from '@/src/lib/workOrderMissing';

const h = vi.hoisted(() => ({
  recon: { data: [] as unknown[], isLoading: false, isError: false, refetch: vi.fn() },
  exportTable: vi.fn(),
}));
vi.mock('@/src/hooks/useBillingStages', () => ({ useBillingReconciliation: () => h.recon }));
vi.mock('@/src/components/export/useExport', () => ({ useExport: () => ({ exportTable: h.exportTable, busy: false }) }));
import { MissingSection } from './MissingSection';

const step: MissingStep = { id: 's1', position: 1, name: 'Step one', ownerRole: 'Finance', done: false, attachments: [{ id: 'a1', name: 'Doc a', required: true, attached: false }] };
const line = { id: 'l1', boqItemId: 'b1', itemCode: 'A1', description: 'Pipe', unit: 'm', accepted: 6 };
const props = { workOrderId: 'w1', projectId: 'p1', status: 'Issued', scopeLines: [], canBilling: true };

beforeEach(() => {
  h.recon = { data: [], isLoading: false, isError: false, refetch: vi.fn() };
  h.exportTable.mockReset();
});

describe('MissingSection', () => {
  it('AC-WML-006 lists steps passed through the seam, their missing attachments and who adds them', () => {
    render(<MissingSection {...props} steps={[step]} />);
    expect(screen.getByTestId('missing-step')).toHaveTextContent('Step one');
    expect(screen.getByTestId('missing-step')).toHaveTextContent('A Finance');
    expect(screen.getByTestId('missing-step-attachment')).toHaveTextContent('Doc a');
    expect(screen.getByTestId('missing-step-attachment')).toHaveTextContent('Nothing is attached yet for step "Step one"');
  });

  it('AC-WML-006 lists quantity reported not accepted and accepted not claimed from the existing reads', () => {
    h.recon.data = [{ boqItemId: 'b1', itemCode: 'A1', description: 'Pipe', unit: 'm', progressQty: 10, billedQty: 2 }];
    render(<MissingSection {...props} scopeLines={[line]} />);
    expect(screen.getByTestId('missing-quantity-accept')).toHaveTextContent('4');
    expect(screen.getByTestId('missing-quantity-claim')).toHaveTextContent('4');
    expect(screen.getByTestId('missing-quantity-claim')).toHaveTextContent('Finance or an Admin');
  });

  it('AC-WML-006 with no step source passed, only quantity rows show and nothing breaks', () => {
    h.recon.data = [{ boqItemId: 'b1', itemCode: 'A1', description: 'Pipe', unit: 'm', progressQty: 10, billedQty: 6 }];
    render(<MissingSection {...props} scopeLines={[line]} />);
    expect(screen.queryByTestId('missing-step')).toBeNull();
    expect(screen.getByTestId('missing-quantity-accept')).toBeInTheDocument();
  });

  it('AC-WML-006 Export sends the rows to the shared CSV export', async () => {
    render(<MissingSection {...props} steps={[step]} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(h.exportTable).toHaveBeenCalledTimes(1);
    const [table, , format] = h.exportTable.mock.calls[0];
    expect(format).toBe('csv');
    expect(table.body.map((r: string[]) => r[0])).toEqual(['Step one', 'Doc a']);
  });

  it('AC-WML-006 empty says nothing is missing and offers no export', () => {
    render(<MissingSection {...props} />);
    expect(screen.getByTestId('missing-empty')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export CSV' })).toBeNull();
  });

  it('AC-WML-006 a failed source shows its own error with retry, not a partial list', async () => {
    const retry = vi.fn();
    render(<MissingSection {...props} steps={[step]} stepsError onRetrySteps={retry} />);
    expect(screen.queryByText('Step one')).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: /retry|try again/i }));
    expect(retry).toHaveBeenCalled();
    expect(h.recon.refetch).toHaveBeenCalled();
  });

  it('AC-WML-006 loading shows a loading state, not the empty message', () => {
    render(<MissingSection {...props} stepsLoading />);
    expect(screen.queryByTestId('missing-empty')).toBeNull();
    expect(screen.queryByTestId('missing-list')).toBeNull();
  });

  it('AC-WML-006 a closed work order says so and lists nothing', () => {
    render(<MissingSection {...props} status="Closed" steps={[step]} />);
    expect(screen.getByTestId('missing-closed')).toBeInTheDocument();
    expect(screen.queryByTestId('missing-step')).toBeNull();
  });

  it('AC-WML-006 a caller who may not see billing gets step rows but no quantity-to-claim rows', () => {
    h.recon.data = [{ boqItemId: 'b1', itemCode: 'A1', description: 'Pipe', unit: 'm', progressQty: 10, billedQty: 0 }];
    render(<MissingSection {...props} canBilling={false} scopeLines={[line]} steps={[step]} />);
    expect(screen.getByTestId('missing-step')).toBeInTheDocument();
    expect(screen.queryByTestId('missing-quantity-claim')).toBeNull();
  });
});
