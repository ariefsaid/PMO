import { describe, it, expect, vi } from 'vitest';

const h = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock('@/src/lib/supabase/client', () => {
  const q: Record<string, unknown> = {};
  for (const k of ['select', 'eq', 'order']) q[k] = () => q;
  q.limit = () => Promise.resolve({ data: h.rows, error: null });
  return { supabase: { from: () => q } };
});

import { listResponsibleCandidates } from './workOrderResponsible';

describe('AC-UW-019 the responsible-person picker', () => {
  it('does not offer a foreman or a field user, who cannot open the work order', async () => {
    h.rows = [
      { id: 'a', full_name: 'Office Eli', built_in_role: 'engineer' },
      { id: 'b', full_name: 'Mandor Budi', built_in_role: 'foreman' },
      { id: 'c', full_name: 'Field Fay', built_in_role: 'field_user' },
      { id: 'd', full_name: 'Plain Pia', built_in_role: null },
    ];
    await expect(listResponsibleCandidates()).resolves.toEqual([{ id: 'a', name: 'Office Eli' }, { id: 'd', name: 'Plain Pia' }]);
  });
});
