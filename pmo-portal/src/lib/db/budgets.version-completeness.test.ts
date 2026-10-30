import { beforeEach, describe, expect, it, vi } from 'vitest';

const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from, rpc } }));
import { listBudgetVersions } from './budgets';

const id = (n: number) => String(n).padStart(5, '0');

describe('complete version reads', () => {
  beforeEach(() => { from.mockReset(); rpc.mockReset(); });

  it('returns every version, line, editor and server total across page boundaries', async () => {
    const versions = Array.from({ length: 1001 }, (_, i) => ({ id: id(i), project_id: 'p', version: i + 1, currency: 'USD' }));
    const lines = Array.from({ length: 1001 }, (_, i) => ({ id: id(i), budget_version_id: id(0), budgeted_amount: '0.01' }));
    const editors = Array.from({ length: 1001 }, (_, i) => ({ budget_version_id: id(0), user_id: id(i) }));
    const totals = versions.map((v, i) => ({ version_id: v.id, total: i === 0 ? '10.01' : '0' }));
    const calls: string[] = [];
    const builder = (table: string, rows: object[]) => {
      let start = 0, end = 999;
      const query = {
        select() { return this; }, eq() { return this; }, in() { return this; }, order() { return this; },
        range(a: number, b: number) { start = a; end = b; return this; },
        then(resolve: (value: unknown) => void) { calls.push(table); return Promise.resolve({ data: rows.slice(start, Math.min(end + 1, start + 1000)), error: null }).then(resolve); },
      };
      return query;
    };
    from.mockImplementation((table: string) => builder(table, ({ budget_versions: versions, budget_line_items: lines, budget_version_editors: editors } as Record<string, object[]>)[table] ?? []));
    rpc.mockImplementation(() => builder('totals', totals));
    const result = await listBudgetVersions('p');
    expect(result).toHaveLength(1001);
    expect(result[0].line_items).toHaveLength(1001);
    expect(result[0].editor_ids).toHaveLength(1001);
    expect(result[0].total).toBe(10.01);
    expect(result[0].currency).toBe('USD');
    expect(calls.filter(x => x === 'budget_line_items')).toHaveLength(2);
  });

  it('rejects a later editor page failure rather than returning a partial editor list', async () => {
    const versions = [{ id: 'v1', project_id: 'p', version: 1 }];
    const editors = Array.from({ length: 1000 }, (_, i) => ({ budget_version_id: 'v1', user_id: id(i) }));
    const builder = (table: string, rows: object[]) => {
      let start = 0;
      return {
        select() { return this; }, eq() { return this; }, order() { return this; },
        range(a: number) { start = a; return this; },
        then(resolve: (value: unknown) => void) {
          const response = table === 'budget_version_editors' && start === 1000
            ? { data: null, error: { message: 'editor page failed', code: '42501' } }
            : { data: rows.slice(start, start + 1000), error: null };
          return Promise.resolve(response).then(resolve);
        },
      };
    };
    from.mockImplementation((table: string) => builder(table, table === 'budget_versions' ? versions : table === 'budget_version_editors' ? editors : []));
    rpc.mockImplementation(() => builder('totals', [{ version_id: 'v1', total: 0 }]));
    await expect(listBudgetVersions('p')).rejects.toMatchObject({ message: 'editor page failed', code: '42501' });
  });
});
