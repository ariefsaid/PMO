import { beforeEach, describe, expect, it, vi } from 'vitest';

// ONE bounded aggregate read: `rpc('budget_version_read')` per page, with an explicit server-side
// page budget, a fail-closed mapper, and a complete legacy fallback when the server reports overflow.
// Every behavioural oracle of the old four-read path is pinned here: complete paging, stable order,
// editor grouping, zero-line versions, exact fractional numerics, malformed-page rejection and
// error propagation.

const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from, rpc } }));

import { listBudgetVersions } from './budgets';

interface AggregateRow {
  version_no: number | null;
  version_id: string | null;
  version_row: Record<string, unknown> | null;
  line_items: unknown;
  editor_ids: unknown;
  total: string | number | null;
  overflow: boolean;
}

const vid = (i: number) => `v-${String(i).padStart(4, '0')}`;

function row(i: number, overrides: Partial<AggregateRow> = {}): AggregateRow {
  return {
    version_no: i,
    version_id: vid(i),
    version_row: {
      id: vid(i), org_id: 'org-1', project_id: 'p1', version: i,
      name: `V${i}`, status: i === 1 ? 'Active' : 'Draft', currency: 'USD',
    },
    line_items: [],
    editor_ids: [],
    total: 0,
    overflow: false,
    ...overrides,
  };
}

const OVERFLOW = {
  version_no: null, version_id: null, version_row: null,
  line_items: null, editor_ids: null, total: null, overflow: true,
};

/** Serves aggregate pages by offset; records every (offset, limit) pair. */
function serveAggregate(pages: AggregateRow[][], opts: { failOffset?: number } = {}) {
  const calls: Array<{ offset: number; limit: number }> = [];
  rpc.mockImplementation((_fn: string, args: { p_offset?: number; p_limit?: number }) => {
    const offset = args?.p_offset ?? 0;
    return {
      then(resolve: (value: unknown) => void) {
        calls.push({ offset, limit: args?.p_limit ?? 1000 });
        if (opts.failOffset === offset) {
          return Promise.resolve({ data: null, error: { message: 'page failed', code: '42501' } }).then(resolve);
        }
        return Promise.resolve({ data: pages[offset / 1000] ?? [], error: null }).then(resolve);
      },
    };
  });
  return { calls };
}

/** Legacy four-read path, served by table so the overflow fallback can be observed end to end. */
function serveLegacy(tables: {
  versions: object[]; lines?: object[]; editors?: object[]; totals?: object[];
}, opts: { failTable?: string; failPage?: number } = {}) {
  const calls: string[] = [];
  const byTable: Record<string, object[]> = {
    budget_versions: tables.versions,
    budget_line_items: tables.lines ?? [],
    budget_version_editors: tables.editors ?? [],
  };
  from.mockImplementation((table: string) => {
    let start = 0;
    const rows = byTable[table] ?? [];
    const builder = {
      select() { return this; },
      eq() { return this; },
      in() { return this; },
      neq() { return this; },
      is() { return this; },
      order() { return this; },
      range(a: number) { start = a; return this; },
      then(resolve: (value: unknown) => void) {
        calls.push(table);
        const response = opts.failTable === table && opts.failPage === start
          ? { data: null, error: { message: 'fallback page failed', code: '42501' } }
          : { data: rows.slice(start, Math.min(start + 1000, start + 1000)), error: null };
        return Promise.resolve(response).then(resolve);
      },
    };
    return builder;
  });
  rpc.mockImplementation((fn: string) => {
    if (fn === 'budget_version_read') {
      return { then: (resolve: (value: unknown) => void) => Promise.resolve({ data: [OVERFLOW], error: null }).then(resolve) };
    }
    let start = 0;
    const rows = tables.totals ?? [];
    return {
      order() { return this; },
      range(a: number) { start = a; return this; },
      then(resolve: (value: unknown) => void) {
        calls.push(fn);
        return Promise.resolve({ data: rows.slice(start, start + 1000), error: null }).then(resolve);
      },
    };
  });
  return { calls };
}

describe('listBudgetVersions — one bounded aggregate invoker read', () => {
  beforeEach(() => { from.mockReset(); rpc.mockReset(); });

  it('issues exactly one budget_version_read RPC with an explicit server-side page budget', async () => {
    const { calls } = serveAggregate([[row(1), row(2)]]);

    await listBudgetVersions('p1');

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('budget_version_read', { p_project_id: 'p1', p_offset: 0, p_limit: 1000 });
    expect(from).not.toHaveBeenCalled();
    expect(calls).toEqual([{ offset: 0, limit: 1000 }]);
  });

  it('never sends org_id or any scope the server must infer itself', async () => {
    serveAggregate([[row(1)]]);
    await listBudgetVersions('p1');
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('org_id');
  });

  it('pages at the exact 1000-row boundary and stops on the empty continuation page', async () => {
    const { calls } = serveAggregate([Array.from({ length: 1000 }, (_, i) => row(i + 1)), []]);

    const result = await listBudgetVersions('p1');

    expect(result).toHaveLength(1000);
    expect(calls).toEqual([{ offset: 0, limit: 1000 }, { offset: 1000, limit: 1000 }]);
  });

  it('returns every version past the 1000-row boundary including the 1001st', async () => {
    const { calls } = serveAggregate([
      Array.from({ length: 1000 }, (_, i) => row(i + 1)),
      [row(1001)],
    ]);

    const result = await listBudgetVersions('p1');

    expect(result).toHaveLength(1001);
    expect(calls).toEqual([{ offset: 0, limit: 1000 }, { offset: 1000, limit: 1000 }]);
    expect(result.map((v) => v.version)).toEqual(Array.from({ length: 1001 }, (_, i) => i + 1));
  });

  it('keeps one version with more than 1000 lines and more than 1000 editors complete', async () => {
    const lines = Array.from({ length: 1001 }, (_, i) => ({
      id: `li-${String(i).padStart(4, '0')}`, budget_version_id: vid(1), budgeted_amount: '0.01',
    }));
    const editors = Array.from({ length: 1001 }, (_, i) => `u-${String(i).padStart(4, '0')}`);
    serveAggregate([[row(1, { line_items: lines, editor_ids: editors, total: '10.01' })]]);

    const result = await listBudgetVersions('p1');

    expect(result[0].line_items).toHaveLength(1001);
    expect(result[0].editor_ids).toHaveLength(1001);
    expect(result[0].total).toBe(10.01);
  });

  it('maps the aggregate row into the existing typed budget version shape', async () => {
    serveAggregate([[row(1, {
      line_items: [
        { id: 'li1', budget_version_id: vid(1), category: 'Labor', budgeted_amount: 3000000, actual_amount: 0 },
        { id: 'li2', budget_version_id: vid(1), category: 'Materials', budgeted_amount: 1700000, actual_amount: 0 },
      ],
      editor_ids: ['u-1', 'u-2'],
      total: 4700000,
    })]]);

    const result = await listBudgetVersions('p1');

    expect(result[0].id).toBe(vid(1));
    expect(result[0].currency).toBe('USD');
    expect(result[0].line_items.map((li) => li.id)).toEqual(['li1', 'li2']);
    expect(result[0].editor_ids).toEqual(['u-1', 'u-2']);
    expect(result[0].total).toBe(4700000);
    expect(typeof result[0].total).toBe('number');
  });

  it('returns [] for a project with no visible version, still through one read', async () => {
    serveAggregate([[]]);
    await expect(listBudgetVersions('p1')).resolves.toEqual([]);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(from).not.toHaveBeenCalled();
  });

  it('retains a zero-line version with an explicit zero total and empty children', async () => {
    serveAggregate([[row(1, { total: 0 })]]);
    const result = await listBudgetVersions('p1');
    expect(result[0].line_items).toEqual([]);
    expect(result[0].editor_ids).toEqual([]);
    expect(result[0].total).toBe(0);
  });

  it('keeps fractional amounts exact end to end', async () => {
    serveAggregate([[row(1, {
      line_items: [{ id: 'li1', budget_version_id: vid(1), budgeted_amount: 1234567.89 }],
      total: '1234567.89',
    })]]);

    const result = await listBudgetVersions('p1');

    expect((result[0].line_items[0] as unknown as { budgeted_amount: number }).budgeted_amount).toBe(1234567.89);
    expect(result[0].total).toBe(1234567.89);
  });

  describe('fail-closed mapping', () => {
    it.each(['NaN', 'Infinity', '', null])('rejects an invalid server total (%s) instead of rendering zero', async (total) => {
      serveAggregate([[row(1, { total: total as string | number | null })]]);
      await expect(listBudgetVersions('p1')).rejects.toMatchObject({ message: 'Missing or invalid budget version total' });
    });

    it('rejects a non-array page body instead of treating it as the end of the set', async () => {
      rpc.mockImplementation(() => ({
        then: (resolve: (value: unknown) => void) => Promise.resolve({ data: null, error: null }).then(resolve),
      }));
      await expect(listBudgetVersions('p1')).rejects.toThrow();
    });

    it.each([
      ['a non-object version row', { version_row: null }],
      ['a version row without an id', { version_row: { project_id: 'p1', version: 1 } }],
      ['an inconsistent version id', { version_id: 'other' }],
      ['an inconsistent version number', { version_no: 99 }],
      ['missing children', { line_items: null }],
      ['a line item from another version', { line_items: [{ id: 'li1', budget_version_id: 'other' }] }],
      ['an invalid editor id', { editor_ids: [''] }],
      ['a non-array editor list', { editor_ids: null }],
    ])('rejects %s rather than returning a partial budget', async (_label, overrides) => {
      serveAggregate([[row(1, overrides as Partial<AggregateRow>)]]);
      await expect(listBudgetVersions('p1')).rejects.toThrow();
    });

    it.each([undefined, null, '1', 1.5, Infinity])('rejects jointly invalid version numbers (%s)', async (value) => {
      const item = row(1);
      const versionRow = { ...item.version_row, version: value };
      serveAggregate([[{ ...item, version_no: value, version_row: versionRow } as unknown as AggregateRow]]);
      await expect(listBudgetVersions('p1')).rejects.toThrow();
    });

    it.each([0, -1])('accepts legacy integer version number %s', async (value) => {
      const item = row(1);
      serveAggregate([[{ ...item, version_no: value, version_row: { ...item.version_row, version: value } } as AggregateRow]]);
      await expect(listBudgetVersions('p1')).resolves.toHaveLength(1);
    });

    it('propagates a later-page error with its code and never returns a partial set', async () => {
      serveAggregate([Array.from({ length: 1000 }, (_, i) => row(i + 1)), []], { failOffset: 1000 });
      const err = await listBudgetVersions('p1').catch((e: unknown) => e);
      expect(err).toMatchObject({ message: 'page failed', code: '42501' });
    });
  });

  describe('oversized page fallback', () => {
    it('discards the aggregate result and returns the COMPLETE legacy four-read set', async () => {
      const versions = [row(1).version_row!, row(2).version_row!];
      const lines = [{ id: 'li1', budget_version_id: vid(1), budgeted_amount: '10.01', budget_versions: { project_id: 'p1' } }];
      const editors = [{ budget_version_id: vid(1), user_id: 'u-1', budget_versions: { project_id: 'p1' } }];
      const totals = [{ version_id: vid(1), total: '10.01' }, { version_id: vid(2), total: '0' }];
      const { calls } = serveLegacy({ versions, lines, editors, totals });

      const result = await listBudgetVersions('p1');

      expect(calls.slice().sort()).toEqual(
        ['budget_versions', 'budget_line_items', 'budget_version_editors', 'budget_version_read_totals'].sort(),
      );
      expect(result).toHaveLength(2);
      expect(result[0].line_items).toHaveLength(1);
      expect(result[0]).not.toHaveProperty('budget_versions');
      expect(result[0].editor_ids).toEqual(['u-1']);
      expect(result[0].total).toBe(10.01);
      expect(result[1].total).toBe(0);
    });

    it('propagates a fallback page error instead of returning aggregated or partial data', async () => {
      const versions = [row(1).version_row!];
      // Aggregate page overflows → the DAL must run the legacy reads; the legacy LINE read then fails
      // on its second page, which must reject rather than yield a shorter budget.
      rpc.mockImplementation((fn: string) => ({
        order() { return this; },
        range() { return this; },
        then: (resolve: (value: unknown) => void) => Promise.resolve(
          fn === 'budget_version_read'
            ? { data: [OVERFLOW], error: null }
            : { data: [{ version_id: vid(1), total: 0 }], error: null },
        ).then(resolve),
      }));
      from.mockImplementation((table: string) => {
        let start = 0;
        return {
          select() { return this; }, eq() { return this; }, order() { return this; },
          range(a: number) { start = a; return this; },
          then(resolve: (value: unknown) => void) {
            if (table === 'budget_versions') {
              return Promise.resolve({ data: versions.slice(start, start + 1000), error: null }).then(resolve);
            }
            if (table === 'budget_line_items' && start === 1000) {
              return Promise.resolve({ data: null, error: { message: 'fallback page failed', code: '42501' } }).then(resolve);
            }
            const rows = table === 'budget_line_items'
              ? Array.from({ length: 1000 }, (_, i) => ({ id: `li-${i}`, budget_version_id: vid(1) }))
              : [];
            return Promise.resolve({ data: rows.slice(start, start + 1000), error: null }).then(resolve);
          },
        };
      });

      await expect(listBudgetVersions('p1')).rejects.toMatchObject({ message: 'fallback page failed', code: '42501' });
    });
  });
});
