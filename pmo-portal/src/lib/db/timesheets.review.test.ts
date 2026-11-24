import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  calls: [] as Array<{ eqs: Array<[string, unknown]>; gtes: Array<[string, unknown]>; ltes: Array<[string, unknown]> }>,
  rows: [] as unknown[],
}));

vi.mock('@/src/lib/supabase/client', () => {
  const makeBuilder = () => {
    const rec = { eqs: [] as Array<[string, unknown]>, gtes: [] as Array<[string, unknown]>, ltes: [] as Array<[string, unknown]> };
    h.calls.push(rec);
    const chain = {
      select: () => chain,
      eq: (k: string, v: unknown) => { rec.eqs.push([k, v]); return chain; },
      gte: (k: string, v: unknown) => { rec.gtes.push([k, v]); return chain; },
      lte: (k: string, v: unknown) => { rec.ltes.push([k, v]); return chain; },
      gt: () => chain,
      order: () => chain,
      limit: async () => ({ data: h.rows, error: null }),
    };
    return chain;
  };
  return { supabase: { from: () => makeBuilder() } };
});

import { listTimesheetsForReview } from './timesheets';

describe('AC-HTR-002 listTimesheetsForReview DAL', () => {
  beforeEach(() => {
    h.calls.length = 0;
    h.rows = [
      {
        id: 'ts-1',
        org_id: 'org-1',
        user_id: 'u-1',
        week_start_date: '2026-11-16',
        status: 'Submitted',
        owner: { id: 'u-1', full_name: 'Sari Putri' },
        entries: [
          { id: 'e-1', timesheet_id: 'ts-1', project_id: 'p-alpha', entry_date: '2026-11-17', hours: '8', notes: 'Site walk', project: { id: 'p-alpha', name: 'Alpha Jetty', short_name: null, code: 'P-01' }, work_order: null },
        ],
      },
      {
        id: 'ts-2',
        org_id: 'org-1',
        user_id: 'u-2',
        week_start_date: '2026-11-09',
        status: 'Approved',
        owner: { id: 'u-2', full_name: 'Budi Santoso' },
        entries: [
          { id: 'e-2', timesheet_id: 'ts-2', project_id: 'p-beta', entry_date: '2026-11-10', hours: '7.5', notes: null, project: { id: 'p-beta', name: 'Beta Tank', short_name: null, code: 'P-02' }, work_order: null },
        ],
      },
    ];
  });

  it('AC-HTR-002 reads via keyset without sending org_id, normalises hours, and filters by period, project and person', async () => {
    const filtered = await listTimesheetsForReview({
      personId: 'u-1',
      projectId: 'p-alpha',
      from: '2026-11-16',
      to: '2026-11-22',
    });
    expect(h.calls[0].eqs).toEqual([['user_id', 'u-1']]);
    expect(h.calls[0].eqs.some(([k]) => k === 'org_id')).toBe(false);
    expect(h.calls[0].gtes).toEqual([['week_start_date', '2026-11-10']]);
    expect(h.calls[0].ltes).toEqual([['week_start_date', '2026-11-22']]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('ts-1');
    expect(filtered[0].entries[0].hours).toBe(8);
  });
});
