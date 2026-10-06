import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  calls: [] as unknown[][],
  result: { data: null as unknown, error: null as unknown },
}));
vi.mock('@/src/lib/supabase/client', () => {
  const chain: Record<string, unknown> = {};
  const rec = (name: string) => (...args: unknown[]) => {
    h.calls.push([name, ...args]);
    return chain;
  };
  Object.assign(chain, {
    select: rec('select'),
    insert: rec('insert'),
    delete: rec('delete'),
    eq: rec('eq'),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(h.result).then(resolve),
  });
  return {
    supabase: {
      from: (table: string) => {
        h.calls.push(['from', table]);
        return chain;
      },
    },
  };
});

import { listSpendApprovers, addSpendApprover, removeSpendApprover } from './spendApprovers';

beforeEach(() => {
  h.calls.length = 0;
  h.result = { data: null, error: null };
});

describe('AC-APR-036 spend-approver DAL', () => {
  it('AC-APR-036: lists and maps rows, senior set first', async () => {
    h.result = {
      data: [
        { id: 'sa-2', project_id: 'p1', profile_id: 'u2', project: { name: 'HQ' }, profile: { full_name: 'Pat' } },
        { id: 'sa-1', project_id: null, profile_id: 'u1', project: null, profile: { full_name: 'Fiona' } },
      ],
      error: null,
    };
    expect(await listSpendApprovers()).toEqual([
      { id: 'sa-1', projectId: null, projectName: null, profileId: 'u1', fullName: 'Fiona' },
      { id: 'sa-2', projectId: 'p1', projectName: 'HQ', profileId: 'u2', fullName: 'Pat' },
    ]);
    expect(h.calls).toContainEqual(['from', 'spend_approvers']);
  });

  it('AC-APR-036: add sends profile_id and project_id, never org_id', async () => {
    h.result = { data: [{ id: 'sa-9' }], error: null };
    await addSpendApprover('u-exec', null);
    expect(h.calls).toContainEqual(['insert', { profile_id: 'u-exec', project_id: null }]);
    expect(JSON.stringify(h.calls)).not.toContain('org_id');
  });

  it('AC-APR-036: remove deletes by id', async () => {
    h.result = { data: [{ id: 'sa-1' }], error: null };
    await removeSpendApprover('sa-1');
    expect(h.calls).toContainEqual(['delete']);
    expect(h.calls).toContainEqual(['eq', 'id', 'sa-1']);
  });

  it('AC-APR-036: a write that lands nothing throws 42501', async () => {
    h.result = { data: [], error: null };
    await expect(addSpendApprover('u-exec', null)).rejects.toMatchObject({ code: '42501' });
  });
});
