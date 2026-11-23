import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectBillingFacts } from '@/src/lib/progressBilling';

const h = vi.hoisted(() => ({ result: { data: [] as unknown[], error: null as { message: string } | null }, from: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: vi.fn() } }));
import { withSurveyFigures } from './progressBilling';

const alloc = (workOrderId: string) => ({ workOrderId, boqItemId: 'b1', quantity: 20, claimedQuantity: 1, acceptedQuantity: null, final: false });
const facts = (): ProjectBillingFacts => ({
  contractLines: [{ boqItemId: 'b1', earningBasis: 'unit_rate', lineNo: null, orderedQuantity: 0, acceptedQuantity: 0, closedFinal: 0, earnedQuantity: 0, contractBalance: 0, allocations: [alloc('w1'), alloc('w2')] }],
} as unknown as ProjectBillingFacts);

beforeEach(() => {
  h.result = { data: [], error: null };
  h.from.mockReset().mockImplementation(() => ({ select: () => ({ in: () => ({ limit: () => Promise.resolve(h.result) }) }) }));
});

describe('AC-SCR-012 withSurveyFigures', () => {
  it('adds the certified and quality-ready quantity to the matching work-order line only', async () => {
    h.result = { data: [{ work_order_id: 'w1', boq_item_id: 'b1', certified_quantity: '8.000', quality_ready_quantity: 5 }], error: null };
    const out = await withSurveyFigures(facts());
    const [a1, a2] = out!.contractLines[0].allocations;
    expect(a1).toMatchObject({ surveyedQuantity: 8, qualityReadyQuantity: 5 });
    expect(a2.surveyedQuantity).toBeUndefined();
  });

  it('leaves every allocation untouched when nothing is certified, and reads nothing without allocations', async () => {
    const out = await withSurveyFigures(facts());
    expect(out!.contractLines[0].allocations[0].surveyedQuantity).toBeUndefined();
    h.from.mockClear();
    await withSurveyFigures({ contractLines: [] } as unknown as ProjectBillingFacts);
    expect(h.from).not.toHaveBeenCalled();
    expect(await withSurveyFigures(null)).toBeNull();
  });

  it('a failed read is an error, not a silent fallback', async () => {
    h.result = { data: [], error: { message: 'boom' } };
    await expect(withSurveyFigures(facts())).rejects.toThrow('boom');
  });
});
