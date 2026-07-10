import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const calls = { table: '', orderCol: '' as string };
  const builder = {
    select() { return builder; },
    order(col: string) { calls.orderCol = col; return builder; },
    then(resolve: (v: unknown) => unknown) {
      return resolve({
        data: [
          { id: 'r1', org_id: 'org-1', external_tier: 'reference', domain: 'reference' },
          { id: 'r2', org_id: 'org-1', external_tier: 'reference', domain: 'tasks' },
        ],
        error: null,
      });
    },
  };
  const from = vi.fn((table: string) => { calls.table = table; return builder; });
  return { from, calls };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import { listOwnExternalDomainOwnership } from './externalDomainOwnership';

// Reset the recorder's FIELDS in place (not reassign `h.calls`) — `from`'s closure captures the
// original `calls` binding from vi.hoisted, so replacing the object reference would desync the
// two and every assertion below would read a never-mutated object (a real defect the RED step
// surfaced; see the implementer report for detail).
beforeEach(() => { h.calls.table = ''; h.calls.orderCol = ''; h.from.mockClear(); });

describe('externalDomainOwnership.listOwnExternalDomainOwnership (supports AC-EAS-015)', () => {
  it('reads own-org rows (RLS-scoped; org_id never sent) + maps to camelCase', async () => {
    const rows = await listOwnExternalDomainOwnership();
    expect(h.calls.table).toBe('external_domain_ownership');
    expect(h.calls.orderCol).toBe('external_tier');
    expect(rows).toEqual([
      { id: 'r1', orgId: 'org-1', externalTier: 'reference', domain: 'reference' },
      { id: 'r2', orgId: 'org-1', externalTier: 'reference', domain: 'tasks' },
    ]);
  });
});
