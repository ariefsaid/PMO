import { describe, it, expect, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

const billing = vi.hoisted(() => vi.fn(async () => [{ workOrderId: 'w1' }]));
vi.mock('../repositories', () => ({ repositories: { workOrder: { billing, billedMonths: vi.fn() } } }));
vi.mock('../repositories/workOrderFinance', () => ({
  workOrderFinanceRepository: { projectPlanVsActual: async (_p: string, readBilling: () => Promise<unknown>) => ({ billing: await readBilling() }) },
}));

import { projectPlanVsActualQuery } from './useWorkOrderPlanVsActual';
import { workOrderBillingQuery } from './useWorkOrderBilling';

describe('#3079 one read of a project billing', () => {
  it('the plan-vs-actual load and the billing hook share one key, so both asked together read it once', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } }); // the app's own default is non-zero too
    const [pva] = await Promise.all([
      client.fetchQuery(projectPlanVsActualQuery('o1', 'p1')),
      client.fetchQuery(workOrderBillingQuery('o1', 'p1')),
    ]);
    expect(billing).toHaveBeenCalledTimes(1);
    expect(pva).toEqual({ billing: [{ workOrderId: 'w1' }] });
  });
});
