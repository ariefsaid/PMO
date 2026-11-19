import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({ data: [] as unknown[], isLoading: false }));
vi.mock('@/src/hooks/useStockSiteWork', () => ({ useWorkOrderStockBalance: () => ({ data: h.data, isLoading: h.isLoading }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import { WorkOrderStockBalance } from './WorkOrderStockBalance';

const row = (extra: Record<string, unknown> = {}) => ({
  workOrderId: 'wo1', itemId: 'i', itemName: 'Valve', unitCode: 'pc', warehouseId: 'w', warehouseCode: 'YARD1', tagName: 'Owner supplied',
  receivedQty: '6', movedOutQty: '4', issuedQty: '0', onSiteQty: '2', ...extra,
});

describe('WorkOrderStockBalance', () => {
  it('AC-SSW-010 no ledger rows shows an empty state and no table of zeros', () => {
    h.data = [];
    render(<WorkOrderStockBalance workOrderId="wo1" currency="IDR" />);
    expect(screen.getByText('siteWork.balance.empty')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('AC-SSW-011 shows the org\'s own tag name from data', () => {
    h.data = [row()];
    render(<WorkOrderStockBalance workOrderId="wo1" currency="IDR" />);
    expect(screen.getByText('Owner supplied')).toBeTruthy();
  });

  it('FR-SSW-031 has no value column when the server sent no value', () => {
    h.data = [row()];
    render(<WorkOrderStockBalance workOrderId="wo1" currency="IDR" />);
    expect(screen.queryByText('siteWork.balance.value')).toBeNull();
  });
});
