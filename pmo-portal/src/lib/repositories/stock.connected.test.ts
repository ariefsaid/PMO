import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/src/lib/db/stockDocuments', () => ({
  getStockDocument: vi.fn(), createStockDocument: vi.fn(), postStockDocument: vi.fn(), getStockErpState: vi.fn(), releaseStockHold: vi.fn(),
}));
vi.mock('@/src/lib/adapterSeam/dispatchClient', () => ({ dispatchDomainCommand: vi.fn() }));
import * as docs from '@/src/lib/db/stockDocuments';
import { dispatchDomainCommand } from '@/src/lib/adapterSeam/dispatchClient';
import { clearOwnershipCache, setTaskOwnership } from '@/src/lib/adapterSeam/ownershipCache';
import { repositories } from '@/src/lib/repositories';
import { StockDispatchError } from '@/src/lib/stockDispatchError';
import { AppError } from '@/src/lib/appError';

const input = (kind: string) => ({ kind, warehouseId: 'w', lines: [] }) as never;
beforeEach(() => { vi.clearAllMocks(); clearOwnershipCache(); });
const connect = () => setTaskOwnership([{ domain: 'inventory', externalTier: 'odoo' }]);

describe('stock repository (connected posting, AC-OSP-006)', () => {
  it('AC-OSP-006 connected create-and-post saves the Draft, then dispatches inventory with the saved revision', async () => {
    connect();
    vi.mocked(docs.createStockDocument).mockResolvedValue('d1');
    vi.mocked(docs.getStockDocument).mockResolvedValue({ id: 'd1', kind: 'transfer', revision: 3 } as never);
    expect(await repositories.stock.documents.create(input('transfer'), { post: true, clientRequestId: 'r' })).toBe('d1');
    expect(docs.createStockDocument).toHaveBeenCalledWith(input('transfer'), { post: false, clientRequestId: 'r' });
    expect(dispatchDomainCommand).toHaveBeenCalledWith('inventory', 'create', { id: 'd1', revision: 3, erp_doc_kind: 'stock-document' });
  });

  it('AC-OSP-006 a refused, held or unanswered dispatch after the save throws an error that carries the draft id', async () => {
    connect();
    vi.mocked(docs.createStockDocument).mockResolvedValue('d1');
    vi.mocked(docs.getStockDocument).mockResolvedValue({ id: 'd1', kind: 'issue', revision: 3 } as never);
    for (const code of ['commit-rejected', 'command-held', 'external-unreachable']) {
      vi.mocked(dispatchDomainCommand).mockRejectedValueOnce(new AppError('no', code, code === 'commit-rejected' ? 'analytic-costs-disabled' : undefined));
      const failure = await repositories.stock.documents.create(input('issue'), { post: true, clientRequestId: 'r' }).catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(StockDispatchError);
      expect(failure).toMatchObject({ documentId: 'd1', code });
    }
    expect(vi.mocked(dispatchDomainCommand).mock.calls.length).toBe(3);
  });

  it('AC-OSP-006 a save whose read-back finds nothing never posts revision 0', async () => {
    connect();
    vi.mocked(docs.createStockDocument).mockResolvedValue('d1');
    vi.mocked(docs.getStockDocument).mockResolvedValue(null as never);
    await expect(repositories.stock.documents.create(input('transfer'), { post: true, clientRequestId: 'r' })).rejects.toMatchObject({ code: 'not-found' });
    expect(dispatchDomainCommand).not.toHaveBeenCalled();
  });

  it('AC-OSP-006 connected post of a transfer or issue dispatches with the viewed revision, never the RPC', async () => {
    connect();
    vi.mocked(docs.getStockDocument).mockResolvedValue({ id: 'd1', kind: 'issue', revision: 9 } as never);
    await repositories.stock.documents.post('d1', 4);
    expect(dispatchDomainCommand).toHaveBeenCalledWith('inventory', 'create', { id: 'd1', revision: 4, erp_doc_kind: 'stock-document' });
    expect(docs.postStockDocument).not.toHaveBeenCalled();
  });

  it('AC-OSP-006 standalone keeps the RPC; other kinds keep today\'s path even when connected', async () => {
    await repositories.stock.documents.post('d1', 4);
    expect(docs.postStockDocument).toHaveBeenCalledWith('d1', 4);
    connect();
    vi.mocked(docs.getStockDocument).mockResolvedValue({ id: 'd2', kind: 'receive', revision: 1 } as never);
    await repositories.stock.documents.post('d2', 1);
    expect(docs.postStockDocument).toHaveBeenCalledWith('d2', 1);
    expect(dispatchDomainCommand).not.toHaveBeenCalled();
  });

  it('AC-OSP-007 erpState and releaseHold delegate', async () => {
    vi.mocked(docs.getStockErpState).mockResolvedValue({ command: null, mirror: null });
    expect(await repositories.stock.documents.erpState('d1')).toEqual({ command: null, mirror: null });
    await repositories.stock.documents.releaseHold('c1');
    expect(docs.releaseStockHold).toHaveBeenCalledWith('c1');
  });
});
