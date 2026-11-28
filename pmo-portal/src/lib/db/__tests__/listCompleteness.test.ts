import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listStockTransfers } from '../stockTransfers';
import { listLabourRates } from '../labourCost';
import { listClearanceItems } from '../clearance';
import { listCandidateRecords } from '../workOrderCandidateRecords';
import { getMyDeliveries } from '../myHome';
import { listReleasePeople } from '../medicalRelease';
import { listResponsibleCandidates } from '../workOrderResponsible';
import { listBoardWorkOrderSteps } from '../workOrderBillingSteps';
import { getOpenMaterialAlertCount, getOpenMaterialAlertCounts } from '../workOrderMaterialAlerts';
import { listPriorRequestLines } from '../materialRequests';
import { withSurveyFigures } from '../progressBilling';
import type { ProjectBillingFacts } from '@/src/lib/progressBilling';

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from } }));

function seed(rows: Record<string, unknown>[]) {
  from.mockImplementation(() => {
    let filtered = rows;
    let first = 0;
    let last = 999;
    let head = false;
    const query = {
      select: (_columns: string, options?: { count?: string; head?: boolean }) => {
        head = options?.count === 'exact' && options.head === true;
        return query;
      },
      eq: () => query,
      is: () => query,
      order: () => query,
      in: (column: string, ids: string[]) => {
        if (column === 'work_order_id') {
          expect(ids.length).toBeLessThanOrEqual(100);
          filtered = filtered.filter((row) => ids.includes(String(row[column])));
        }
        return query;
      },
      limit: (limit: number) => { last = Math.min(limit, 1000) - 1; return query; },
      range: (start: number, end: number) => { first = start; last = Math.min(end, start + 999); return query; },
      then: (resolve: (value: unknown) => void) => resolve({
        data: head ? null : filtered.slice(first, last + 1),
        count: head ? filtered.length : null,
        error: null,
      }),
    };
    return query;
  });
}

beforeEach(() => from.mockReset());

describe('complete list and picker reads', () => {
  it.each([
    ['stock transfers', 200, () => listStockTransfers()],
    ['labour rates', 500, listLabourRates],
    ['clearance items', 500, listClearanceItems],
    ['candidate records', 200, () => listCandidateRecords('project')],
    ['my deliveries', 20, () => getMyDeliveries('recipient')],
    ['medical-release people', 500, listReleasePeople],
    ['responsible people', 500, listResponsibleCandidates],
    ['billing board work orders', 500, () => listBoardWorkOrderSteps('project')],
    ['prior material request lines', 200, () => listPriorRequestLines('work-order', 'item')],
  ] as const)('AC-2811-001: %s includes the row beyond the previous limit of %i', async (_label, limit, read) => {
    seed(Array.from({ length: limit + 1 }, (_, index) => ({
      id: String(index),
      status: 'accepted',
      steps: [{ id: String(index), documents: [] }],
      material_requests: { id: String(index), created_at: '2026-11-26' },
    })));

    await expect(read()).resolves.toHaveLength(limit + 1);
  });

  it('AC-2811-002: the open material alert count includes all 501 items', async () => {
    seed(Array.from({ length: 501 }, (_, index) => ({ item_id: String(index) })));
    await expect(getOpenMaterialAlertCount('work-order')).resolves.toEqual({ workOrderId: 'work-order', itemCount: 501 });
  });

  it('AC-1128-001: open alert counts for 101 work orders are read in bounded requests and counted per work order', async () => {
    const ids = Array.from({ length: 101 }, (_, index) => String(index));
    seed([{ work_order_id: '0', item_id: 'a' }, { work_order_id: '0', item_id: 'b' }, { work_order_id: '100', item_id: 'c' }]);
    const counts = await getOpenMaterialAlertCounts(ids);
    expect(counts['0']).toBe(2);
    expect(counts['100']).toBe(1);
    expect(counts['50']).toBe(0);
    expect(from).toHaveBeenCalledTimes(2);
  });

  it('AC-2811-003: a survey read pages past 5000 lines and bounds the work orders in each request', async () => {
    const workOrderIds = Array.from({ length: 101 }, (_, index) => String(index));
    seed(Array.from({ length: 5002 }, (_, index) => ({
      work_order_id: index === 5001 ? '100' : '0',
      boq_item_id: String(index),
      certified_quantity: index,
      quality_ready_quantity: index - 1,
    })));
    const contractLines = [
      { boqItemId: '5000', allocations: workOrderIds.map((workOrderId) => ({ workOrderId })) },
      { boqItemId: '5001', allocations: [{ workOrderId: '100' }] },
    ] as ProjectBillingFacts['contractLines'];
    const result = await withSurveyFigures({ contractLines } as ProjectBillingFacts);

    expect(result?.contractLines[0]?.allocations[0]).toMatchObject({ surveyedQuantity: 5000, qualityReadyQuantity: 4999 });
    expect(result?.contractLines[1]?.allocations[0]).toMatchObject({ surveyedQuantity: 5001, qualityReadyQuantity: 5000 });
  });
});
