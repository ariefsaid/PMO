import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/src/lib/adapterSeam/dispatchClient', () => ({ dispatchDomainCommand: vi.fn() }));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ clearOwnershipCache: vi.fn(), setTaskOwnership: vi.fn(), routeDomainWrite: vi.fn() }));
vi.mock('@/src/lib/db/progressBilling', () => ({
  listBoqItems: vi.fn(), createBoqItem: vi.fn(), updateBoqItem: vi.fn(), deleteBoqItem: vi.fn(),
  listProjectClaims: vi.fn(), createProgressClaim: vi.fn(), withdrawProgressClaim: vi.fn(), getProjectBilling: vi.fn(),
  attachClaimEvidence: vi.fn(), recordProgressAssessment: vi.fn(),
}));
import { dispatchDomainCommand } from '@/src/lib/adapterSeam/dispatchClient';
import { routeDomainWrite } from '@/src/lib/adapterSeam/ownershipCache';
import * as dal from '@/src/lib/db/progressBilling';
import { repositories } from '@/src/lib/repositories';
import { AppError } from '@/src/lib/appError';

beforeEach(() => vi.clearAllMocks());

describe('progressBilling repository', () => {
  it('AC-PB-009 raising dispatches a sales-invoice create whose record id is the claim id', async () => {
    vi.mocked(routeDomainWrite).mockReturnValue('external');
    vi.mocked(dispatchDomainCommand).mockResolvedValue({ externalRecordId: 'ACC-SINV-1', canonical: { id: 'claim-1', si_number: 'ACC-SINV-1' } } as never);
    const result = await repositories.progressBilling.raiseInvoice(
      { claimId: 'claim-1', projectId: 'proj-1', customerId: 'cust-1' }, { id: 'session-intent', idempotencyKey: 'key-1' });
    expect(dispatchDomainCommand).toHaveBeenCalledWith('revenue', 'create',
      { erp_doc_kind: 'sales-invoice', projectId: 'proj-1', customerId: 'cust-1', id: 'claim-1' }, { idempotencyKey: 'key-1' });
    expect(result).toEqual({ id: 'claim-1', si_number: 'ACC-SINV-1' });
  });

  it('AC-PB-009 raising is refused without an ERP connection and never dispatches', async () => {
    vi.mocked(routeDomainWrite).mockReturnValue('pmo');
    await expect(repositories.progressBilling.raiseInvoice({ claimId: 'claim-1', projectId: 'proj-1', customerId: 'cust-1' }))
      .rejects.toBeInstanceOf(AppError);
    expect(dispatchDomainCommand).not.toHaveBeenCalled();
  });

  it('AC-PB-009 creating a claim passes the input to the claim RPC', async () => {
    vi.mocked(dal.createProgressClaim).mockResolvedValue('claim-2');
    const input = { projectId: 'proj-1', kind: 'progress' as const, workOrderId: null, lines: [{ boqItemId: 'b1', quantity: 4 }], recoverRemaining: false };
    expect(await repositories.progressBilling.createClaim(input)).toBe('claim-2');
    expect(dal.createProgressClaim).toHaveBeenCalledWith(input);
  });

  it('AC-PB-019 an assessment never dispatches anything', async () => {
    vi.mocked(dal.recordProgressAssessment).mockResolvedValue(40);
    expect(await repositories.progressBilling.recordAssessment({ projectId: 'proj-1', month: '2026-09-01', quantities: [], note: null })).toBe(40);
    expect(dispatchDomainCommand).not.toHaveBeenCalled();
  });

  it('AC-CQ-012 BoQ create and update delegate the basis and line number exactly, with no work order', async () => {
    const input = { itemCode: 'A-1', description: 'Cable', unit: 'km', quantity: 1900, rate: 50, earningBasis: 'unit_rate' as const, lineNo: 2 };
    vi.mocked(dal.createBoqItem).mockResolvedValue({ id: 'b1' } as never);
    await repositories.progressBilling.createBoq('proj-1', input);
    expect(dal.createBoqItem).toHaveBeenCalledWith('proj-1', input);
    await repositories.progressBilling.updateBoq('b1', { ...input, earningBasis: 'lump_sum', quantity: 1, lineNo: null });
    expect(dal.updateBoqItem).toHaveBeenCalledWith('b1', { ...input, earningBasis: 'lump_sum', quantity: 1, lineNo: null });
  });

  it('AC-CQ-012 the summary returns the earned-value facts untouched, and null for an invisible project', async () => {
    const facts = { earnedValue: 450_000, contractLines: [] } as never;
    vi.mocked(dal.getProjectBilling).mockResolvedValueOnce(facts);
    expect(await repositories.progressBilling.summary('proj-1')).toBe(facts);
    vi.mocked(dal.getProjectBilling).mockResolvedValueOnce(null);
    expect(await repositories.progressBilling.summary('proj-1')).toBeNull();
    expect(dal.getProjectBilling).toHaveBeenCalledWith('proj-1');
  });
});
