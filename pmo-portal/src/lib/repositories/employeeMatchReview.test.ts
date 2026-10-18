import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProfileRow } from '@/src/lib/db/profiles';

const h = vi.hoisted(() => {
  const state = {
    rows: [] as unknown[],
    profiles: [] as unknown[],
    employeeError: null as { message: string; code?: string } | null,
    profileError: null as Error | null,
  };
  const calls = {
    tables: [] as string[],
    selects: [] as string[],
    states: [] as unknown[][],
    equalities: [] as unknown[][],
    orders: [] as unknown[][],
    cursors: [] as string[],
    limits: [] as number[],
    profileReads: 0,
    profileArgs: [] as unknown[][],
  };

  const listOrgProfiles = vi.fn(async (...args: unknown[]) => {
    calls.profileReads += 1;
    calls.profileArgs.push(args);
    if (state.profileError) throw state.profileError;
    return state.profiles;
  });

  const from = vi.fn((table: string) => {
    calls.tables.push(table);
    const query = { states: [] as string[], equality: null as { column: string; value: string } | null, cursor: null as string | null };
    const builder: Record<string, unknown> = {};
    builder.select = (columns: string) => {
      calls.selects.push(columns);
      return builder;
    };
    builder.in = (column: string, values: string[]) => {
      calls.states.push([column, values]);
      query.states = values;
      return builder;
    };
    builder.eq = (column: string, value: string) => {
      calls.equalities.push([column, value]);
      query.equality = { column, value };
      return builder;
    };
    builder.order = (...args: unknown[]) => {
      calls.orders.push(args);
      return builder;
    };
    builder.gt = (column: string, cursor: string) => {
      expect(column).toBe('id');
      query.cursor = cursor;
      calls.cursors.push(cursor);
      return builder;
    };
    builder.limit = (limit: number) => {
      calls.limits.push(limit);
      if (state.employeeError) return Promise.resolve({ data: null, error: state.employeeError });
      const rows = state.rows
        .filter((row) => query.equality
          ? (row as Record<string, string>)[query.equality.column] === query.equality.value
          : query.states.includes((row as { link_state: string }).link_state))
        .filter((row) => query.cursor === null || (row as { id: string }).id > query.cursor)
        .sort((a, b) => (a as { id: string }).id.localeCompare((b as { id: string }).id));
      return Promise.resolve({ data: rows.slice(0, limit), error: null });
    };
    return builder;
  });

  return { state, calls, from, listOrgProfiles };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));
vi.mock('@/src/lib/db/profiles', () => ({ listOrgProfiles: h.listOrgProfiles }));

import { listEmployeeMatchReview } from './employeeMatchReview';

const profile = (
  id: string,
  full_name: string,
  email: string,
  status: 'active' | 'disabled' = 'active',
): ProfileRow => ({
  id,
  full_name,
  email,
  status,
  role: 'Engineer',
  org_id: 'synthetic-org',
} as ProfileRow);

const employee = (
  id: string,
  link_state: 'proposed' | 'unlinked' | 'confirmed',
  profile_id: string | null,
  joinedProfile: { full_name?: string | null; email?: string | null } | null,
) => ({
  id,
  link_state,
  employee_name: `Synthetic employee ${id}`,
  employee_number: `WORKER-${id}`,
  work_email: `${id}@example.test`,
  link_proposed_reason: link_state === 'unlinked' ? 'No confident PMO match was found' : 'Synthetic proposal',
  profile_id,
  profile: joinedProfile,
});

beforeEach(() => {
  h.state.rows = [];
  h.state.profiles = [];
  h.state.employeeError = null;
  h.state.profileError = null;
  h.calls.tables.length = 0;
  h.calls.selects.length = 0;
  h.calls.states.length = 0;
  h.calls.equalities.length = 0;
  h.calls.orders.length = 0;
  h.calls.cursors.length = 0;
  h.calls.limits.length = 0;
  h.calls.profileReads = 0;
  h.calls.profileArgs.length = 0;
  h.from.mockClear();
  h.listOrgProfiles.mockClear();
});

describe('listEmployeeMatchReview (AC-S30-003)', () => {
  it('AC-S30-003: returns proposed and unlinked employee rows with only active, identifiable RLS profile candidates', async () => {
    h.state.rows = [
      employee('emp-a', 'proposed', 'profile-one', { full_name: 'Casey Reviewer', email: 'casey.one@example.test' }),
      employee('emp-b', 'unlinked', null, null),
      employee('emp-c', 'confirmed', 'profile-confirmed', { full_name: 'Already Linked', email: 'already@example.test' }),
      employee('emp-d', 'proposed', 'missing-profile', null),
    ];
    h.state.profiles = [
      profile('profile-one', 'Casey Reviewer', 'casey.one@example.test'),
      profile('profile-two', 'Casey Reviewer', 'casey.two@example.test'),
      profile('profile-confirmed', 'Already Linked', 'already@example.test'),
      profile('profile-disabled', 'Disabled Reviewer', 'disabled@example.test', 'disabled'),
      profile('profile-no-identity', '', ''),
    ];

    const result = await listEmployeeMatchReview();

    expect(result.links.map(({ id }) => id)).toEqual(['emp-a', 'emp-b', 'emp-d']);
    expect(result.links[0]).toMatchObject({
      profile_id: 'profile-one',
      profile_name: 'Casey Reviewer',
      profile_email: 'casey.one@example.test',
    });
    expect(result.links[1]).toMatchObject({ profile_id: null, profile_name: null, profile_email: null });
    expect(result.links[2]).toMatchObject({ profile_id: 'missing-profile', profile_name: null, profile_email: null });
    expect(result.profiles.map(({ id, full_name, email }) => ({ id, full_name, email }))).toEqual([
      { id: 'profile-one', full_name: 'Casey Reviewer', email: 'casey.one@example.test' },
      { id: 'profile-two', full_name: 'Casey Reviewer', email: 'casey.two@example.test' },
    ]);
    expect(h.calls.tables).toEqual(['erp_employees', 'erp_employees']);
    expect(h.calls.states).toEqual([['link_state', ['proposed', 'unlinked']]]);
    expect(h.calls.equalities).toEqual([['link_state', 'confirmed']]);
    expect(h.calls.orders).toEqual([['id', { ascending: true }], ['id', { ascending: true }]]);
    expect(h.calls.profileReads).toBe(1);
    expect(h.calls.profileArgs).toEqual([[]]);
    expect(JSON.stringify({ selects: h.calls.selects, states: h.calls.states })).not.toContain('org_id');
    expect(JSON.stringify(result.links)).not.toContain('profile-no-identity');
    expect(result.profiles.map(({ id }) => id)).not.toContain('profile-confirmed');
  });

  it('AC-S30-003: keyset-pages beyond the PostgREST row cap without dropping employee rows', async () => {
    h.state.rows = Array.from({ length: 1001 }, (_, index) => {
      const id = `employee-${String(index).padStart(4, '0')}`;
      return employee(id, 'unlinked', null, null);
    });
    h.state.profiles = [profile('profile-active', 'Taylor Reviewer', 'taylor@example.test')];

    const result = await listEmployeeMatchReview();

    expect(result.links).toHaveLength(1001);
    expect(result.links[0]?.id).toBe('employee-0000');
    expect(result.links.at(-1)?.id).toBe('employee-1000');
    expect(h.calls.limits.sort()).toEqual([1000, 1000, 1000]);
    expect(h.calls.cursors).toEqual(['employee-0999']);
  });

  it('AC-S30-003: propagates employee read errors rather than returning a partial review queue', async () => {
    h.state.employeeError = { message: 'synthetic employee read denied', code: '42501' };

    await expect(listEmployeeMatchReview()).rejects.toMatchObject({
      message: 'synthetic employee read denied',
      code: '42501',
    });
  });

  it('AC-S30-003: propagates candidate profile read errors rather than presenting an incomplete identity list', async () => {
    h.state.profileError = new Error('synthetic profile read failed');

    await expect(listEmployeeMatchReview()).rejects.toThrow('synthetic profile read failed');
  });
});
