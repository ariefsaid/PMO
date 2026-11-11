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
  postStockDocument: vi.fn(), cancelStockDocument: vi.fn(), listIssuableWorkItems: vi.fn(), listProjectIssueLines: vi.fn(),
}));
vi.mock('@/src/lib/db/stockReports', () => ({ getStockOnHand: vi.fn(), getStockLedgerPage: vi.fn(), getStockLedgerAll: vi.fn(), getProjectConsumption: vi.fn() }));
vi.mock('@/src/lib/db/stockAllowances', () => ({ listAllowances: vi.fn(), setAllowance: vi.fn(), clearAllowance: vi.fn() }));
import * as docs from '@/src/lib/db/stockDocuments';
import * as reports from '@/src/lib/db/stockReports';
import * as allowances from '@/src/lib/db/stockAllowances';

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

describe('stock repository (consumption and allowances, S5)', () => {
  it('FR-STK-042 consumption.report delegates project and range', async () => {
    vi.mocked(reports.getProjectConsumption).mockResolvedValue({ from: 'a', to: 'b', months: [], allowances: [], unplanned: [] });
    await repositories.stock.consumption.report('p1', '2026-09-01', '2026-11-30');
    expect(reports.getProjectConsumption).toHaveBeenCalledWith('p1', '2026-09-01', '2026-11-30');
  });

  it('FR-STK-044 a failing consumption report surfaces as an AppError', async () => {
    vi.mocked(reports.getProjectConsumption).mockRejectedValue({ message: 'boom', code: '500' });
    await expect(repositories.stock.consumption.report('p1', 'a', 'b')).rejects.toBeInstanceOf(AppError);
  });

  it('FR-STK-050 allowances.list / set / clear delegate to the DAL', async () => {
    vi.mocked(allowances.listAllowances).mockResolvedValue([]);
    vi.mocked(allowances.setAllowance).mockResolvedValue(undefined);
    vi.mocked(allowances.clearAllowance).mockResolvedValue(undefined);
    await repositories.stock.allowances.list('p1');
    const input = { boqItemId: 'b', itemId: 'i', plannedQuantity: '10' };
    await repositories.stock.allowances.set(input);
    await repositories.stock.allowances.clear('a1');
    expect(allowances.listAllowances).toHaveBeenCalledWith('p1');
    expect(allowances.setAllowance).toHaveBeenCalledWith(input);
    expect(allowances.clearAllowance).toHaveBeenCalledWith('a1');
  });
});
