import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ inserted: null as unknown, updated: null as unknown }));
vi.mock('@/src/lib/supabase/client', () => ({
  supabase: {
    from: () => ({
      insert: (row: unknown) => {
        h.inserted = row;
        return { select: () => ({ single: async () => ({ data: { id: 'p1' }, error: null }) }) };
      },
      update: (row: unknown) => {
        h.updated = row;
        return { eq: () => ({ select: async () => ({ data: [{ id: 'p1' }], error: null }) }) };
      },
    }),
  },
}));

import { createProcurement, updateProcurementHeader } from './procurementCrud';

beforeEach(() => {
  h.inserted = null;
  h.updated = null;
});

describe('AC-APR-033 budget category is carried on create and header edit', () => {
  it('AC-APR-033: create sends budget_category and never org_id', async () => {
    await createProcurement({ title: 'Cable', projectId: 'pr1', vendorId: null, budgetCategory: 'Materials' }, 'u1');
    expect(h.inserted).toMatchObject({ budget_category: 'Materials', project_id: 'pr1' });
    expect(JSON.stringify(h.inserted)).not.toContain('org_id');
  });

  it('AC-APR-033: create without a category leaves the column unset', async () => {
    await createProcurement({ title: 'Cable', projectId: null, vendorId: null }, 'u1');
    expect(h.inserted).not.toHaveProperty('budget_category');
  });

  it('AC-APR-033: header edit sends a cleared category as null', async () => {
    await updateProcurementHeader('p1', { title: 'Cable', projectId: 'pr1', vendorId: null, budgetCategory: null });
    expect(h.updated).toMatchObject({ budget_category: null });
  });
});
