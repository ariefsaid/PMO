import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/src/lib/db/stockMaster', () => ({
  listStockUnits: vi.fn(), listStockItems: vi.fn(), listStockWarehouses: vi.fn(), listWarehouseKeepers: vi.fn(),
  createStockUnit: vi.fn(), updateStockUnit: vi.fn(), createStockItem: vi.fn(), updateStockItem: vi.fn(),
  createStockWarehouse: vi.fn(), updateStockWarehouse: vi.fn(), setArchived: vi.fn(), setWarehouseKeeper: vi.fn(),
}));
import * as dal from '@/src/lib/db/stockMaster';
import { repositories } from '@/src/lib/repositories';
import { AppError } from '@/src/lib/appError';

beforeEach(() => vi.clearAllMocks());

describe('stock repository (master data)', () => {
  it('FR-STK-001 listItems delegates to the DAL with the archived flag', async () => {
    vi.mocked(dal.listStockItems).mockResolvedValue([{ id: 'i1' }] as never);
    expect(await repositories.stock.master.listItems(true)).toEqual([{ id: 'i1' }]);
    expect(dal.listStockItems).toHaveBeenCalledWith(true);
  });

  it('FR-STK-004 setKeeper delegates the exact assignment', async () => {
    vi.mocked(dal.setWarehouseKeeper).mockResolvedValue(undefined);
    const a = { warehouseId: 'w1', userId: 'u1', assigned: false };
    await repositories.stock.master.setKeeper(a);
    expect(dal.setWarehouseKeeper).toHaveBeenCalledWith(a);
  });

  it('FR-STK-006 archive delegates table, id and direction', async () => {
    vi.mocked(dal.setArchived).mockResolvedValue(undefined);
    await repositories.stock.master.archive('stock_items', 'i1', false);
    expect(dal.setArchived).toHaveBeenCalledWith('stock_items', 'i1', false);
  });

  it('every method is wrapped: a thrown Error surfaces as AppError with its code kept', async () => {
    vi.mocked(dal.listStockUnits).mockRejectedValue(Object.assign(new Error('nope'), { code: '42501' }));
    const err = await repositories.stock.master.listUnits().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ message: 'nope', code: '42501' });
    vi.mocked(dal.createStockWarehouse).mockRejectedValue(new Error('boom'));
    await expect(repositories.stock.master.createWarehouse({ code: 'W', name: 'W', kind: 'site', projectId: null })).rejects.toBeInstanceOf(AppError);
  });
});

vi.mock('@/src/lib/db/stockDocuments', () => ({
  listStockDocuments: vi.fn(), getStockDocument: vi.fn(), createStockDocument: vi.fn(), saveStockDraft: vi.fn(),
  postStockDocument: vi.fn(), cancelStockDocument: vi.fn(), listIssuableWorkItems: vi.fn(),
}));
vi.mock('@/src/lib/db/stockReports', () => ({ getStockOnHand: vi.fn(), getStockLedgerPage: vi.fn(), getStockLedgerAll: vi.fn() }));
import * as docs from '@/src/lib/db/stockDocuments';
import * as reports from '@/src/lib/db/stockReports';

describe('stock repository (documents and reports)', () => {
  it('FR-STK-015 create delegates the input and the request id', async () => {
    vi.mocked(docs.createStockDocument).mockResolvedValue('d1');
    const input = { kind: 'receive' as const, warehouseId: 'w', lines: [] };
    expect(await repositories.stock.documents.create(input, { post: true, clientRequestId: 'r' })).toBe('d1');
    expect(docs.createStockDocument).toHaveBeenCalledWith(input, { post: true, clientRequestId: 'r' });
  });

  it('FR-STK-044 a failing report read surfaces as an AppError, never an empty list', async () => {
    vi.mocked(reports.getStockOnHand).mockRejectedValue({ message: 'boom', code: '500' });
    await expect(repositories.stock.reports.onHand({})).rejects.toBeInstanceOf(AppError);
  });

  it('FR-STK-041 ledgerAll delegates the filters', async () => {
    vi.mocked(reports.getStockLedgerAll).mockResolvedValue([]);
    await repositories.stock.reports.ledgerAll({ documentId: 'd1' });
    expect(reports.getStockLedgerAll).toHaveBeenCalledWith({ documentId: 'd1' });
  });
});
