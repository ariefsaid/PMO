import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as milestones from '@/src/lib/db/milestones';
import * as workOrders from '@/src/lib/db/workOrders';
import * as billing from '@/src/lib/db/workOrderBilling';
import * as progress from '@/src/lib/db/progressBilling';
import * as acceptances from '@/src/lib/db/workOrderAcceptances';
import { routeDomainWrite } from '@/src/lib/adapterSeam/ownershipCache';
import { dispatchDomainCommand } from '@/src/lib/adapterSeam/dispatchClient';
import { milestoneRepository, workOrderRepository, progressBillingRepository, workOrderAcceptanceRepository } from './workOrders';
import { itDelegates } from './__tests__/delegation';

vi.mock('@/src/lib/db/milestones');
vi.mock('@/src/lib/db/workOrders');
vi.mock('@/src/lib/db/workOrderBilling');
vi.mock('@/src/lib/db/progressBilling');
vi.mock('@/src/lib/db/workOrderAcceptances');
vi.mock('@/src/lib/adapterSeam/ownershipCache');
vi.mock('@/src/lib/adapterSeam/dispatchClient');

describe('milestoneRepository', () => {
  itDelegates(milestoneRepository as never, milestones, [
    ['list', 'listMilestones', ['p1']],
    ['deliveryForProjects', 'getProjectsDelivery', [['p1', 'p2']]],
    ['deliverySummaryForProjects', 'getProjectsDeliverySummary', [['p1']]],
    ['milestoneDatesForProjects', 'getProjectsMilestoneDates', [['p1']]],
    ['create', 'createMilestone', [{ name: 'M1' }, 'p1']],
    ['update', 'updateMilestone', ['m1', { name: 'M2' }]],
    ['delete', 'deleteMilestone', ['m1']],
    ['setTaskMilestone', 'updateTaskMilestone', ['t1', 'm1']],
  ]);
});

describe('workOrderRepository', () => {
  itDelegates(workOrderRepository as never, { ...workOrders, ...billing }, [
    ['list', 'listProjectWorkOrders', ['p1']],
    ['get', 'getWorkOrder', ['wo1']],
    ['create', 'createWorkOrder', ['p1', { title: 'WO' }]],
    ['update', 'updateWorkOrder', ['wo1', { title: 'WO2' }]],
    ['setValue', 'setWorkOrderValue', [{ id: 'wo1', value: 100 }]],
    ['transition', 'transitionWorkOrder', ['wo1', 'active', { note: 'go' }]],
    ['drawdown', 'getProjectDrawdown', ['p1']],
    ['billing', 'listWorkOrderBilling', ['p1']],
    ['unbilled', 'getUnbilledWorkOrders', [10]],
  ]);
});

describe('progressBillingRepository', () => {
  itDelegates(progressBillingRepository as never, progress, [
    ['listBoq', 'listBoqItems', ['p1']],
    ['createBoq', 'createBoqItem', ['p1', { name: 'item' }]],
    ['updateBoq', 'updateBoqItem', ['b1', { name: 'item2' }]],
    ['deleteBoq', 'deleteBoqItem', ['b1']],
    ['recordAssessment', 'recordProgressAssessment', [{ boqItemId: 'b1', percent: 10 }]],
    ['listClaims', 'listProjectClaims', ['p1']],
    ['createClaim', 'createProgressClaim', [{ projectId: 'p1' }]],
    ['attachEvidence', 'attachClaimEvidence', ['c1', 'd1']],
    ['withdrawClaim', 'withdrawProgressClaim', ['c1']],
    ['summary', 'getProjectBilling', ['p1']],
  ]);

  describe('raiseInvoice', () => {
    const claim = { claimId: 'claim-1', projectId: 'p1', customerId: 'cust-1' };
    beforeEach(() => { vi.mocked(dispatchDomainCommand).mockReset(); });

    it('dispatches a sales-invoice create keyed by the claim id and the caller intent', async () => {
      vi.mocked(routeDomainWrite).mockReturnValue('external');
      vi.mocked(dispatchDomainCommand).mockResolvedValue({ canonical: { id: 'inv-1', si_number: 'SINV-1' } } as never);
      const res = await progressBillingRepository.raiseInvoice(claim as never, { id: 'x', idempotencyKey: 'key-1' } as never);
      expect(res).toEqual({ id: 'inv-1', si_number: 'SINV-1' });
      expect(dispatchDomainCommand).toHaveBeenCalledWith(
        'revenue', 'create',
        { erp_doc_kind: 'sales-invoice', projectId: 'p1', customerId: 'cust-1', id: expect.any(String) },
        { idempotencyKey: 'key-1' },
      );
    });

    it('mints a fresh idempotency key when no intent is given, and defaults si_number to empty', async () => {
      vi.mocked(routeDomainWrite).mockReturnValue('external');
      vi.mocked(dispatchDomainCommand).mockResolvedValue({ canonical: { id: 'inv-2' } } as never);
      const res = await progressBillingRepository.raiseInvoice(claim as never);
      expect(res).toEqual({ id: 'inv-2', si_number: '' });
      expect(vi.mocked(dispatchDomainCommand).mock.calls[0][3]).toEqual({ idempotencyKey: expect.any(String) });
    });

    it('refuses when revenue is not externally owned, without dispatching', async () => {
      vi.mocked(routeDomainWrite).mockReturnValue('pmo');
      await expect(progressBillingRepository.raiseInvoice(claim as never)).rejects.toMatchObject({ code: 'revenue-not-enabled' });
      expect(dispatchDomainCommand).not.toHaveBeenCalled();
    });
  });
});

describe('workOrderAcceptanceRepository', () => {
  itDelegates(workOrderAcceptanceRepository as never, acceptances, [
    ['listByProject', 'listProjectAcceptances', ['p1']],
    ['listLines', 'listWorkOrderLines', ['wo1']],
    ['listProjectLines', 'listProjectWorkOrderLines', ['p1']],
    ['createLine', 'createWorkOrderLine', [{ workOrderId: 'wo1', quantity: 2 }]],
    ['updateLine', 'updateWorkOrderLine', ['l1', 3]],
    ['deleteLine', 'deleteWorkOrderLine', ['l1']],
    ['prepare', 'prepareWorkOrderAcceptance', [{ workOrderId: 'wo1' }]],
    ['withdraw', 'withdrawWorkOrderAcceptance', ['a1']],
    ['confirm', 'confirmWorkOrderAcceptance', ['a1']],
  ]);
});
