import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => {
  const tables: Record<string, Record<string, unknown>[]> = {};
  const query = (table: string) => {
    let from = 0, to = 999;
    const b = {
      select: () => b, eq: () => b, in: () => b, order: () => b,
      limit: (n: number) => { to = Math.min(n, 1000) - 1; return b; },
      range: (a: number, z: number) => { from = a; to = z; return b; },
      then: (resolve: (v: unknown) => unknown) => resolve({ data: (tables[table] ?? []).slice(from, to + 1), error: null }),
    };
    return b;
  };
  return { tables, query };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.query, rpc: h.query } }));
vi.mock('./stockSiteWork', () => ({ uploadStockDocumentFile: vi.fn() }));
import { getWorkOrderClientMaterial } from './clientRequisitions';
beforeEach(() => { for (const key of Object.keys(h.tables)) delete h.tables[key]; });
it('AC-READ-001 reads every client-material collection beyond the response cap', async () => {
 h.tables.client_requisitions = [{ id: 'r1' }];
 h.tables.csr_work_order_rollup = Array.from({ length: 1001 }, (_, i) => ({ line_id: String(i), requisition_id: 'r1' }));
 for (const table of ['client_requisition_lines', 'client_requisition_events', 'client_requisition_pickups']) {
  h.tables[table] = Array.from({ length: 1001 }, (_, i) => ({ id: String(i), work_order_line_id: `w${i}` }));
 }
 const result = await getWorkOrderClientMaterial('wo');
 expect(result.lines).toHaveLength(1001);
 expect(result.events).toHaveLength(1001);
 expect(result.pickups).toHaveLength(1001);
 expect(result.lines[1000].workOrderLineId).toBe('w1000');
});

it('AC-READ-001 reads requisitions beyond their former declared cap', async () => {
  h.tables.client_requisitions = Array.from({ length: 1001 }, (_, i) => ({ id: String(i) }));
  const result = await getWorkOrderClientMaterial('wo');
  expect(result.requisitions.map(r => r.id)).toEqual(h.tables.client_requisitions.map(r => r.id));
});
