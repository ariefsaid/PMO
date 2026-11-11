import { beforeEach, describe, expect, it, vi } from 'vitest';

const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from, rpc } }));
import { listBudgetVersions } from './budgets';

const id = (n: number) => String(n).padStart(5, '0');

interface Row {
  version_no: number | null;
  version_id: string | null;
  version_row: Record<string, unknown> | null;
  line_items: unknown;
  editor_ids: unknown;
  total: string | number | null;
  overflow: boolean;
}

function aggregatePage(rows: Row[], opts: { failPage?: number } = {}) {
  rpc.mockImplementation((_fn: string, args: { p_offset?: number }) => ({
    then: (resolve: (value: unknown) => void) => {
      const start = args?.p_offset ?? 0;
      const response = opts.failPage === start
        ? { data: null, error: { message: 'page failed', code: '42501' } }
        : { data: rows.slice(start, start + 1000), error: null };
      return Promise.resolve(response).then(resolve);
    },
  }));
}

describe('complete version reads', () => {
  beforeEach(() => { from.mockReset(); rpc.mockReset(); });

  it('returns every version, line, editor and server total across page boundaries', async () => {
    const rows: Row[] = Array.from({ length: 1001 }, (_, i) => ({
      version_no: i + 1,
      version_id: id(i),
      version_row: { id: id(i), project_id: 'p', version: i + 1, name: `V${i + 1}`, currency: 'USD' },
      line_items: i === 0
        ? Array.from({ length: 1001 }, (_, n) => ({ id: id(n), budget_version_id: id(0), budgeted_amount: '0.01' }))
        : [],
      editor_ids: i === 0 ? Array.from({ length: 1001 }, (_, n) => id(n)) : [],
      total: i === 0 ? '10.01' : '0',
      overflow: false,
    }));
    aggregatePage(rows);

    const result = await listBudgetVersions('p');

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(from).not.toHaveBeenCalled();
    expect(result).toHaveLength(1001);
    expect(result[0].line_items).toHaveLength(1001);
    expect(result[0].editor_ids).toHaveLength(1001);
    expect(result[0].total).toBe(10.01);
    expect(result[1].total).toBe(0);
    expect(result[0].currency).toBe('USD');
    expect(new Set(result.map((v) => v.id)).size).toBe(1001);
  });

  it('rejects a later page failure rather than returning a partial version list', async () => {
    aggregatePage(
      Array.from({ length: 1001 }, (_, i) => ({
        version_no: i + 1, version_id: id(i),
        version_row: { id: id(i), project_id: 'p', version: i + 1 },
        line_items: [], editor_ids: [], total: '0', overflow: false,
      })),
      { failPage: 1000 },
    );
    await expect(listBudgetVersions('p')).rejects.toMatchObject({ message: 'page failed', code: '42501' });
  });
});
