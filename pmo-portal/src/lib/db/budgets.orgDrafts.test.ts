import { describe, expect, it, vi } from 'vitest';

const tables = vi.hoisted(() => ({} as Record<string, unknown[]>));
vi.mock('@/src/lib/supabase/client', () => {
  const chain = (table: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'order']) q[m] = () => q;
    q.range = (from: number, to: number) => Promise.resolve({ data: (tables[table] ?? []).slice(from, to + 1), error: null });
    return q;
  };
  return { supabase: { from: (t: string) => chain(t) } };
});

import { listOrgDraftBudgets } from './budgets';

describe('listOrgDraftBudgets (#1273)', () => {
  it('AC-BAD-001 sums line totals per draft, keeps editors and the first source link, and tolerates no drafts', async () => {
    tables.budget_versions = [
      { id: 'v1', project_id: 'p1', version: 2, name: 'Imported', created_by: 'u1', budget_mode: 'whole_project', projects: { code: 'PRJ-1', name: 'Alpha', currency: 'IDR', start_date: '2026-02-01', end_date: '2026-06-30' } },
      { id: 'v2', project_id: 'p2', version: 1, name: 'Imported', created_by: null, budget_mode: 'per_year', projects: [{ code: null, name: 'Beta', currency: 'IDR', start_date: null, end_date: null }] },
    ];
    tables.budget_line_items = [
      { id: 'l1', budget_version_id: 'v1', category: 'Labor', budgeted_amount: 100 },
      { id: 'l2', budget_version_id: 'v1', category: 'Materials', budgeted_amount: '50.5' },
    ];
    tables.budget_version_editors = [{ budget_version_id: 'v1', user_id: 'u1' }];
    tables.budget_version_document_links = [
      { id: 'd1', budget_version_id: 'v1', ms_web_url: 'https://sp.example/first' },
      { id: 'd2', budget_version_id: 'v1', ms_web_url: 'https://sp.example/second' },
    ];
    const rows = await listOrgDraftBudgets();
    expect(rows).toEqual([
      { id: 'v1', projectId: 'p1', projectCode: 'PRJ-1', projectName: 'Alpha', currency: 'IDR', version: 2, name: 'Imported', total: 150.5, createdBy: 'u1', editorIds: ['u1'], documentUrl: 'https://sp.example/first',
        budgetMode: 'whole_project', projectStart: '2026-02-01', projectEnd: '2026-06-30', lines: [{ category: 'Labor', budgeted_amount: 100 }, { category: 'Materials', budgeted_amount: '50.5' }] },
      { id: 'v2', projectId: 'p2', projectCode: null, projectName: 'Beta', currency: 'IDR', version: 1, name: 'Imported', total: 0, createdBy: null, editorIds: [], documentUrl: null,
        budgetMode: 'per_year', projectStart: null, projectEnd: null, lines: [] },
    ]);
    tables.budget_versions = [];
    expect(await listOrgDraftBudgets()).toEqual([]);
  });
});
