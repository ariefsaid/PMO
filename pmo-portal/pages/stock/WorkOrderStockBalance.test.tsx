import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({ data: [] as unknown[], isLoading: false, isError: false, ownership: 'pmo', synced: true }));
vi.mock('@/src/hooks/useStockSiteWork', () => ({ useWorkOrderStockBalance: () => ({ data: h.data, isLoading: h.isLoading, isError: h.isError, refetch: vi.fn() }) }));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeDomainWrite: () => h.ownership, isOwnershipCacheSynced: () => h.synced, subscribeOwnershipCache: () => () => {} }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import { WorkOrderStockBalance } from './WorkOrderStockBalance';

const row = (extra: Record<string, unknown> = {}) => ({
  workOrderId: 'wo1', itemId: 'i', itemName: 'Valve', unitCode: 'pc', warehouseId: 'w', warehouseCode: 'YARD1', tagName: 'Owner supplied',
  receivedQty: '6', movedOutQty: '4', issuedQty: '0', onSiteQty: '2', ...extra,
});

describe('WorkOrderStockBalance', () => {
  it('shows an error rather than claiming no stock when the read fails', () => {
    h.isError = true; h.data = [];
    render(<WorkOrderStockBalance workOrderId="wo1" currency="IDR" />);
    expect(screen.getByText('siteWork.balance.error')).toBeTruthy();
    expect(screen.queryByText('siteWork.balance.empty')).toBeNull();
    h.isError = false;
  });

  it('shows loading instead of an empty table while stock is being fetched', () => {
    h.isLoading = true; h.data = [];
    render(<WorkOrderStockBalance workOrderId="wo1" currency="IDR" />);
    expect(screen.getByText('siteWork.balance.loading')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    h.isLoading = false;
  });

  it('waits for inventory ownership before showing a balance', () => {
    h.synced = false; h.data = [];
    render(<WorkOrderStockBalance workOrderId="wo1" currency="IDR" />);
    expect(screen.getByText('siteWork.balance.loading')).toBeTruthy();
    expect(screen.queryByText('siteWork.balance.empty')).toBeNull();
    h.synced = true;
  });

  it('does not claim no movements when inventory is owned by Odoo', () => {
    h.ownership = 'external'; h.data = [];
    render(<WorkOrderStockBalance workOrderId="wo1" currency="IDR" />);
    expect(screen.getByText('siteWork.balance.connectedUnavailable')).toBeTruthy();
    expect(screen.queryByText('siteWork.balance.empty')).toBeNull();
    h.ownership = 'pmo';
  });

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

  it('retains exact value for large ledger amounts', () => {
    h.data = [row({ onSiteValue: '9007199254740993.00' })];
    render(<WorkOrderStockBalance workOrderId="wo1" currency="USD" />);
    expect(screen.getByText(/9,007,199,254,740,993/)).toBeTruthy();
  });

  it('shows issued value separately from stock remaining on site', () => {
    h.data = [row({ onSiteValue: '8.00', issuedValue: '20.00' })];
    render(<WorkOrderStockBalance workOrderId="wo1" currency="USD" />);
    expect(screen.getByText('$20.00')).toBeTruthy();
    expect(screen.getByText('$8.00')).toBeTruthy();
  });

  it('FR-SSW-031 has no value column when the server sent no value', () => {
    h.data = [row()];
    render(<WorkOrderStockBalance workOrderId="wo1" currency="IDR" />);
    expect(screen.queryByText('siteWork.balance.value')).toBeNull();
  });
});
