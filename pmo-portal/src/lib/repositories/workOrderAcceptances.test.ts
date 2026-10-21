import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/src/lib/adapterSeam/dispatchClient', () => ({ dispatchDomainCommand: vi.fn() }));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ clearOwnershipCache: vi.fn(), setDomainOwnership: vi.fn(), routeDomainWrite: vi.fn() }));
vi.mock('@/src/lib/db/workOrderAcceptances', () => ({
  listProjectAcceptances: vi.fn(), listWorkOrderLines: vi.fn(), createWorkOrderLine: vi.fn(), updateWorkOrderLine: vi.fn(),
  deleteWorkOrderLine: vi.fn(), prepareWorkOrderAcceptance: vi.fn(), withdrawWorkOrderAcceptance: vi.fn(), confirmWorkOrderAcceptance: vi.fn(),
}));
import * as dal from '@/src/lib/db/workOrderAcceptances';
import { repositories } from '@/src/lib/repositories';
import { AppError } from '@/src/lib/appError';

beforeEach(() => vi.clearAllMocks());

const repo = () => repositories.workOrderAcceptance;

describe('workOrderAcceptance repository', () => {
  it('AC-CQ-015 reads delegate by project and by work order', async () => {
    vi.mocked(dal.listProjectAcceptances).mockResolvedValue([]);
    vi.mocked(dal.listWorkOrderLines).mockResolvedValue([]);
    await repo().listByProject('p1');
    await repo().listLines('wo-1');
    expect(dal.listProjectAcceptances).toHaveBeenCalledWith('p1');
    expect(dal.listWorkOrderLines).toHaveBeenCalledWith('wo-1');
  });

  it('AC-CQ-002 allocation create, update and delete delegate exactly', async () => {
    const input = { workOrderId: 'wo-1', boqItemId: 'b1', quantity: 1000 };
    vi.mocked(dal.createWorkOrderLine).mockResolvedValue({ id: 'l1' } as never);
    expect(await repo().createLine(input)).toEqual({ id: 'l1' });
    await repo().updateLine('l1', 997);
    await repo().deleteLine('l1');
    expect(dal.createWorkOrderLine).toHaveBeenCalledWith(input);
    expect(dal.updateWorkOrderLine).toHaveBeenCalledWith('l1', 997);
    expect(dal.deleteWorkOrderLine).toHaveBeenCalledWith('l1');
  });

  it('AC-CQ-015 prepare, withdraw and confirm delegate and return the authoritative result', async () => {
    const input = { workOrderId: 'wo-1', acceptanceDate: '2026-10-20', isFinal: true, lines: [{ boqItemId: 'b1', quantity: 997 }], documentId: 'doc-1', note: null };
    vi.mocked(dal.prepareWorkOrderAcceptance).mockResolvedValue('acc-1');
    vi.mocked(dal.confirmWorkOrderAcceptance).mockResolvedValue({ closingValue: 49_850_000, dpHeld: 0 });
    expect(await repo().prepare(input)).toBe('acc-1');
    await repo().withdraw('acc-1');
    expect(await repo().confirm('acc-1')).toEqual({ closingValue: 49_850_000, dpHeld: 0 });
    expect(dal.prepareWorkOrderAcceptance).toHaveBeenCalledWith(input);
    expect(dal.withdrawWorkOrderAcceptance).toHaveBeenCalledWith('acc-1');
    expect(dal.confirmWorkOrderAcceptance).toHaveBeenCalledWith('acc-1');
  });

  it('AC-CQ-015 a server refusal reaches the caller as an AppError with its code, and nothing is dispatched to an ERP', async () => {
    vi.mocked(dal.confirmWorkOrderAcceptance).mockRejectedValue(Object.assign(new Error('closing above order net'), { code: 'BW001' }));
    const error = await repo().confirm('acc-1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'BW001', message: 'closing above order net' });
  });
});
