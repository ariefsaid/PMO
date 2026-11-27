import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthContext } from '@/src/auth/AuthContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const h = vi.hoisted(() => ({ rows: [] as unknown[], isError: false, refetch: vi.fn() }));
vi.mock('@/src/hooks/useMaterialRequests', () => ({ useInstalledUsageWarnings: () => ({ data: h.rows, isError: h.isError, refetch: h.refetch }) }));

import { WorkOrderUsageWarningBanner } from './WorkOrderUsageWarningBanner';

const wrap = (ui: React.ReactNode) => (
  <AuthContext.Provider value={{ currentUser: { id: 'u', org_id: 'o' } } as never}><QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider></AuthContext.Provider>);

describe('AC-UW-012 the work order card shows installed material past the warning', () => {
  it('keeps a failed warning check visible and retryable without blocking work', async () => {
    h.isError = true;
    const { rerender } = render(wrap(<WorkOrderUsageWarningBanner workOrderId="w1" />));
    expect(screen.getByText('Material usage warnings are unavailable.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.refetch).toHaveBeenCalled();
    h.isError = false;
    h.rows = [];
    rerender(wrap(<WorkOrderUsageWarningBanner workOrderId="w1" />));
    expect(screen.queryByText('Material usage warnings are unavailable.')).not.toBeInTheDocument();
  });
  it('names the item, installed against plan and the threshold', () => {
    h.rows = [{ itemId: 'i1', itemName: 'Cement', unit: 'BAG', installedQty: 85, planQty: 100, threshold: 80 }];
    render(wrap(<WorkOrderUsageWarningBanner workOrderId="w1" />));
    const row = screen.getByRole('row', { name: /Cement/ });
    const cells = within(row).getAllByRole('cell').map((c) => c.textContent);
    expect(cells).toEqual(['85 BAG', '100 BAG', '80%']);
  });
  it('renders nothing when no warning is recorded', () => {
    h.rows = [];
    const { container } = render(wrap(<WorkOrderUsageWarningBanner workOrderId="w1" />));
    expect(container).toBeEmptyDOMElement();
  });
});
