import { describe, expect, it, vi } from 'vitest';
import { feedAccountMirror } from './accountMirrorFeed.ts';

const row = (name: string, parent: string | null, lft: number, rgt: number) => ({
  name, company: 'Synthetic Co', account_name: name, root_type: 'Asset', report_type: 'Balance Sheet',
  parent_account: parent, is_group: parent === null, account_number: null, account_currency: 'IDR',
  lft, rgt, account_type: null, include_in_gross: false, disabled: false, modified: '2026-01-01',
});
function fakeClient() {
  const calls: Array<{ method: string; values?: unknown; filters: unknown[] }> = [];
  const query = (_table: string) => {
    const state = { filters: [] as unknown[] };
    const builder = {
      eq: (column: string, value: unknown) => { state.filters.push([column, value]); return builder; },
      not: (column: string, operator: string, value: string) => { state.filters.push([column, operator, value]); return builder; },
      delete: () => { calls.push({ method: 'delete', filters: [...state.filters] }); return builder; },
      upsert: async (values: unknown) => { calls.push({ method: 'upsert', values, filters: [...state.filters] }); return { error: null }; },
      then: (resolve: (x: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
    };
    return builder;
  };
  return { calls, from: vi.fn(query) };
}

describe('account mirror reconciliation', () => {
  it('AC-005: validates complete chart before upsert and removes obsolete company identities', async () => {
    const service = fakeClient();
    const result = await feedAccountMirror(service as never, { orgId: 'org-synthetic', company: 'Synthetic Co', refreshId: 'refresh-1', asOf: '2026-01-02T00:00:00Z', accounts: [row('Assets', null, 1, 4), row('Cash', 'Assets', 2, 3)] });
    expect(result).toMatchObject({ upserted: 2, removed: true });
    expect(service.calls.map((c) => c.method)).toEqual(['upsert', 'delete']);
    expect(service.calls[0].values).toEqual(expect.arrayContaining([expect.objectContaining({ erp_name: 'Cash', org_id: 'org-synthetic', refresh_id: 'refresh-1' })]));
  });

  it('AC-005: rejects missing parent and duplicate identity before any mirror write', async () => {
    const service = fakeClient();
    await expect(feedAccountMirror(service as never, { orgId: 'org-synthetic', company: 'Synthetic Co', refreshId: 'r', asOf: '2026-01-02T00:00:00Z', accounts: [row('Child', 'Missing', 2, 3)] })).rejects.toThrow(/parent/i);
    expect(service.calls).toHaveLength(0);
  });
});
