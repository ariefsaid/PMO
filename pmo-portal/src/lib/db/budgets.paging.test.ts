import { beforeEach, describe, expect, it, vi } from 'vitest';

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from } }));
import { listBudgetArchiveLiveTargets, listBudgetDocumentLinks } from './budgets';

const target = (i: number) => ({
  id: String(i).padStart(4, '0'), budget_version_id: 'v1', fiscal_year: '2026',
  erp_account: '5100', erp_budget_name: 'BUD', erp_docstatus: 1,
  erp_cancelled_at: null, push_state: 'pushed', budget_intent: 'ensure',
  activated_at_witness: '2026-01-01',
});

function setup(rows: object[], options: { errorPage?: number; bindingError?: boolean } = {}) {
  const calls: Array<[number, number]> = [];
  const orders: string[] = [];
  const filters: unknown[][] = [];
  from.mockImplementation((table: string) => {
    if (table === 'external_org_bindings') return {
      select() { return this; }, eq() { return this; },
      maybeSingle: async () => ({ data: { version_major: 16, activated_at: '2026-01-01' }, error: options.bindingError ? { message: 'binding failed' } : null }),
    };
    let start = 0;
    let end = 999;
    const builder = {
      select() { return this; },
      eq(...args: unknown[]) { filters.push(args); return this; },
      in(...args: unknown[]) { filters.push(args); return this; },
      neq(...args: unknown[]) { filters.push(args); return this; },
      is(...args: unknown[]) { filters.push(args); return this; },
      order(column: string) { orders.push(column); return this; },
      range(a: number, b: number) { start = a; end = b; calls.push([a, b]); return this; },
      then(resolve: (value: unknown) => void) {
        return Promise.resolve(options.errorPage === start ? { data: null, error: { message: 'page failed', code: '42501', details: 'read-denied' } } : { data: rows.slice(start, Math.min(end + 1, start + 1000)), error: null }).then(resolve);
      },
    };
    return builder;
  });
  return { calls, orders, filters };
}

beforeEach(() => from.mockReset());

describe('complete budget reads', () => {
  it('returns every eligible archive target across pages and preserves exclusions and binding failure posture', async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => target(i));
    rows.push({ ...target(1001), erp_docstatus: 2 });
    const { calls, orders, filters } = setup(rows, { bindingError: true });
    const result = await listBudgetArchiveLiveTargets(['v1']);
    expect(result.map(row => row.id)).toEqual(rows.slice(0, 1001).map(row => row.id));
    expect(result.every(row => !row.archive_cancellation_available)).toBe(true);
    expect(calls).toEqual([[0, 999], [1000, 1999]]);
    expect(orders).toEqual(['id', 'id']);
    expect(filters).toContainEqual(['budget_version_id', ['v1']]);
    expect(filters).toContainEqual(['erp_account', '']);
    expect(filters).toContainEqual(['erp_cancelled_at', null]);
  });

  it('returns every document link in link-time and id order across pages', async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => ({ id: String(i).padStart(4, '0'), budget_version_id: 'v1', ms_linked_at: '2026-01-01' }));
    const { calls, orders, filters } = setup(rows);
    await expect(listBudgetDocumentLinks('v1')).resolves.toEqual(rows);
    expect(calls).toEqual([[0, 999], [1000, 1999]]);
    expect(orders).toEqual(['ms_linked_at', 'id', 'ms_linked_at', 'id']);
    expect(filters).toContainEqual(['budget_version_id', 'v1']);
  });

  it.each(['archive', 'links'])('rejects a later %s page error with its code', async (kind) => {
    setup(Array.from({ length: 1001 }, (_, i) => target(i)), { errorPage: 1000 });
    const result = kind === 'archive' ? listBudgetArchiveLiveTargets(['v1']) : listBudgetDocumentLinks('v1');
    await expect(result).rejects.toMatchObject({ message: 'page failed', code: '42501', details: 'read-denied' });
  });
});
