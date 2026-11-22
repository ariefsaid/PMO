import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuthContext } from '@/src/auth/AuthContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const h = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock('@/src/hooks/useMaterialRequests', () => ({ useInstalledUsageWarnings: () => ({ data: h.rows }) }));

import { WorkOrderUsageWarningBanner } from './WorkOrderUsageWarningBanner';

const wrap = (ui: React.ReactNode) => (
  <AuthContext.Provider value={{ currentUser: { id: 'u', org_id: 'o' } } as never}><QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider></AuthContext.Provider>);

describe('AC-UW-012 the work order card shows installed material past the warning', () => {
  it('names the item, installed against plan and the threshold', () => {
    h.rows = [{ itemId: 'i1', itemName: 'Cement', unit: 'BAG', installedQty: 85, planQty: 100, threshold: 80 }];
    render(wrap(<WorkOrderUsageWarningBanner workOrderId="w1" />));
    expect(screen.getByTestId('wo-usage-warning')).toHaveTextContent('Cement: 85 of 100 BAG planned installed, past the 80% warning.');
  });
  it('renders nothing when no warning is recorded', () => {
    h.rows = [];
    const { container } = render(wrap(<WorkOrderUsageWarningBanner workOrderId="w1" />));
    expect(container).toBeEmptyDOMElement();
  });
});
