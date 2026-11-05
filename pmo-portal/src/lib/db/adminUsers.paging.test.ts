import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Administration › Users directory is the app's org member list. It is read with a SERVER
 * page + exact total, an explicit directory projection (never `select *`), a server-side
 * name/email search, and a total (deterministic) order so pages cannot repeat or skip a person.
 */
const h = vi.hoisted(() => {
  const calls = {
    select: [] as unknown[][],
    or: [] as string[],
    order: [] as string[],
    range: [] as number[][],
    eq: [] as unknown[][],
  };
  let result: { data: unknown; error: unknown; count?: number | null } = { data: [], error: null, count: 0 };
  const queue: Array<{ data: unknown; error: unknown; count?: number | null }> = [];
  const next = () => (queue.length ? queue.shift()! : result);
  const from = vi.fn(() => {
    const q: Record<string, unknown> = {};
    q.select = (...args: unknown[]) => { calls.select.push(args); return q; };
    q.or = (filter: string) => { calls.or.push(filter); return q; };
    q.order = (column: string) => { calls.order.push(column); return q; };
    q.eq = (...args: unknown[]) => { calls.eq.push(args); return q; };
    q.range = (a: number, b: number) => { calls.range.push([a, b]); return q; };
    q.then = (resolve: (value: unknown) => unknown) => resolve(next());
    q.maybeSingle = () => Promise.resolve(next());
    return q;
  });
  return {
    from,
    calls,
    setResult: (nextResult: typeof result) => { result = nextResult; },
    pushResult: (nextResult: typeof result) => { queue.push(nextResult); },
    reset: () => {
      from.mockClear();
      calls.select.length = 0;
      calls.or.length = 0;
      calls.order.length = 0;
      calls.range.length = 0;
      calls.eq.length = 0;
      queue.length = 0;
      result = { data: [], error: null, count: 0 };
    },
  };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import {
  countActiveAdminsByOrg,
  findUserPage,
  listManagerChoices,
  listUsersPage,
  MANAGER_CHOICE_COLUMNS,
  USER_DIRECTORY_COLUMNS,
} from './adminUsers';

const person = (i: number) => ({
  id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
  full_name: `Person ${String(i).padStart(3, '0')}`,
  email: `person-${i}@acme.test`,
  role: 'Engineer',
  status: 'active',
  org_id: 'org-1',
  manager_id: null,
  manager: null,
});

beforeEach(() => h.reset());

describe('AC-AU-001 directory server page', () => {
  it('reads ONE page with an exact total and a total deterministic order, never select *', async () => {
    h.setResult({ data: [person(51)], error: null, count: 51 });
    const page = await listUsersPage({ page: 2, pageSize: 50 });

    expect(page.total).toBe(51);
    expect(page.rows.map((row) => row.id)).toEqual([person(51).id]);
    expect(h.calls.range).toEqual([[50, 99]]);
    expect(h.calls.order).toEqual(['full_name', 'id']);
    // The projection is explicit AND the manager's name travels with the row (the manager may not
    // be on the visible page); a wildcard would return the whole 17-column profile row.
    expect(h.calls.select[0]).toEqual([USER_DIRECTORY_COLUMNS, { count: 'exact' }]);
    // The self-FK hint must be the FK COLUMN: PostgREST rejects a constraint-name hint on a
    // self-referencing embed (PGRST200), which failed the whole directory read at runtime.
    expect(USER_DIRECTORY_COLUMNS).toContain('manager:profiles!manager_id(full_name)');
    expect(USER_DIRECTORY_COLUMNS).not.toMatch(/profiles_manager_id_fkey/);
    expect(USER_DIRECTORY_COLUMNS).not.toContain('*');
    expect(USER_DIRECTORY_COLUMNS).not.toMatch(/\bskills\b|\butilization\b|\btimezone\b|\bavatar_url\b/);
    // org_id is never sent — RLS scopes the rows.
    expect(h.calls.eq).toEqual([]);
  });

  it('applies a search on the SERVER before the range, escaping LIKE metacharacters', async () => {
    await listUsersPage({ page: 1, pageSize: 50, search: '50%_off"\\x' });
    expect(h.calls.or).toEqual(['full_name.ilike."%50\\%\\_off\\"\\\\x%",email.ilike."%50\\%\\_off\\"\\\\x%"']);
    expect(h.calls.range).toEqual([[0, 49]]);
  });

  it('omits the search filter when the term is blank or whitespace', async () => {
    await listUsersPage({ page: 1, pageSize: 50, search: '   ' });
    expect(h.calls.or).toEqual([]);
  });

  it('treats a zero exact count as a real empty result (the only verified zero)', async () => {
    h.setResult({ data: [], error: null, count: 0 });
    await expect(listUsersPage({ page: 1, pageSize: 50 })).resolves.toEqual({ rows: [], total: 0 });
  });

  it('reports a missing exact count as unresolved/error, never as a verified zero total', async () => {
    // An absent count is the server failing to answer "how many"; rendering it as `0` would show a
    // false empty directory / "0 of 0" over a set that may hold rows.
    h.setResult({ data: [], error: null, count: null });
    await expect(listUsersPage({ page: 3, pageSize: 50 })).rejects.toMatchObject({
      code: 'COUNT_UNRESOLVED',
    });
  });

  it('preserves the Postgres error code so the page can classify it', async () => {
    h.setResult({ data: null, error: { message: 'permission denied', code: '42501' }, count: null });
    await expect(listUsersPage({ page: 1, pageSize: 50 })).rejects.toMatchObject({
      message: 'permission denied',
      code: '42501',
    });
  });
});

describe('sole active Admin predicate (per org, whole org)', () => {
  it('counts active Admins per org with a HEAD count filtered to that org', async () => {
    h.setResult({ data: null, error: null, count: 2 });
    await expect(countActiveAdminsByOrg(['org-1'])).resolves.toEqual({ 'org-1': 2 });
    expect(h.calls.select[0]).toEqual(['id', { count: 'exact', head: true }]);
    expect(h.calls.eq).toEqual([['org_id', 'org-1'], ['role', 'Admin'], ['status', 'active']]);
    expect(h.calls.range).toEqual([]);
  });

  it('counts each distinct org exactly once', async () => {
    h.setResult({ data: null, error: null, count: 1 });
    await expect(countActiveAdminsByOrg(['org-2', 'org-1', 'org-2'])).resolves.toEqual({ 'org-2': 1, 'org-1': 1 });
    expect(h.calls.eq.filter(([column]) => column === 'org_id')).toEqual([['org_id', 'org-2'], ['org_id', 'org-1']]);
  });

  it('reports an unresolved count as null, never as zero admins', async () => {
    h.setResult({ data: null, error: null, count: null });
    await expect(countActiveAdminsByOrg(['org-1'])).resolves.toEqual({ 'org-1': null });
  });

  it('throws a read error instead of claiming a count', async () => {
    h.setResult({ data: null, error: { message: 'denied', code: '42501' }, count: null });
    await expect(countActiveAdminsByOrg(['org-1'])).rejects.toMatchObject({ code: '42501' });
  });
});

describe('manager picker choices (complete, minimal, all pages)', () => {
  const choice = (i: number) => ({
    id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
    full_name: `Person ${String(i).padStart(4, '0')}`,
    role: 'Engineer',
  });

  it('reads only the three fields the picker renders — never a whole profile row', async () => {
    h.setResult({ data: [choice(1)], error: null });
    await expect(listManagerChoices()).resolves.toEqual([choice(1)]);
    expect(h.calls.select[0]).toEqual([MANAGER_CHOICE_COLUMNS]);
    expect(MANAGER_CHOICE_COLUMNS).toBe('id,full_name,role');
    expect(MANAGER_CHOICE_COLUMNS).not.toContain('*');
    expect(MANAGER_CHOICE_COLUMNS).not.toMatch(/email|manager_id|org_id|skills|role_id/);
    // Total order: name then id, so the picker has one deterministic ordering across pages.
    expect(h.calls.order).toEqual(['full_name', 'id']);
  });

  it('pages the WHOLE choice set — a full first page is followed, no silent row-cap', async () => {
    const firstPage = Array.from({ length: 1000 }, (_, i) => choice(i + 1));
    h.pushResult({ data: firstPage, error: null });
    h.pushResult({ data: [choice(1001), choice(1002), choice(1003)], error: null });
    const choices = await listManagerChoices();
    expect(choices).toHaveLength(1003);
    expect(choices.at(-1)).toEqual(choice(1003));
    expect(h.calls.range).toEqual([[0, 999], [1000, 1999]]);
  });

  it('throws a paged-read error instead of returning a short, silently truncated list', async () => {
    h.pushResult({ data: Array.from({ length: 1000 }, (_, i) => choice(i + 1)), error: null });
    h.pushResult({ data: null, error: { message: 'denied', code: '42501' } });
    await expect(listManagerChoices()).rejects.toMatchObject({ code: '42501' });
  });
});

describe('manager page jump (bounded, exact person)', () => {
  it('finds the person page by counting the rows that sort before them — no directory scan', async () => {
    h.pushResult({ data: { id: 'u9', full_name: 'Ada Lovelace', email: 'ada@acme.test' }, error: null });
    h.pushResult({ data: null, error: null, count: 100 });
    await expect(findUserPage({ userId: 'u9', pageSize: 50 })).resolves.toEqual({
      page: 3,
      email: 'ada@acme.test',
      full_name: 'Ada Lovelace',
    });
    // Exact-person read is bounded by the PK.
    expect(h.calls.select[0]).toEqual(['id,full_name,email']);
    expect(h.calls.eq).toEqual([['id', 'u9']]);
    // The count is a HEAD count over the tuple that sorts before (full_name, id), with the name quoted.
    expect(h.calls.select[1]).toEqual(['id', { count: 'exact', head: true }]);
    expect(h.calls.or).toEqual(['full_name.lt."Ada Lovelace",and(full_name.eq."Ada Lovelace",id.lt.u9)']);
    expect(h.calls.range).toEqual([]);
  });

  it('quotes a name containing filter punctuation', async () => {
    h.pushResult({ data: { id: 'u9', full_name: 'Smith, "Jo" (Jr)', email: 'jo@acme.test' }, error: null });
    h.pushResult({ data: null, error: null, count: 0 });
    await expect(findUserPage({ userId: 'u9', pageSize: 50 })).resolves.toMatchObject({ page: 1 });
    expect(h.calls.or[0]).toContain('full_name.lt."Smith, \\"Jo\\" (Jr)"');
  });

  it('returns null when the person is not readable', async () => {
    h.pushResult({ data: null, error: null });
    await expect(findUserPage({ userId: 'u9', pageSize: 50 })).resolves.toBeNull();
    expect(h.calls.or).toEqual([]);
  });

  it('throws when the position count fails', async () => {
    h.pushResult({ data: { id: 'u9', full_name: 'Ada', email: 'ada@acme.test' }, error: null });
    h.pushResult({ data: null, error: { message: 'denied', code: '42501' }, count: null });
    await expect(findUserPage({ userId: 'u9', pageSize: 50 })).rejects.toMatchObject({ code: '42501' });
  });

  it('reports a missing position count as unresolved, never as page one', async () => {
    // An absent exact count is the server failing to answer "how many people sort before them".
    // Reading it as 0 would claim page 1 and announce the person as showing there.
    h.pushResult({ data: { id: 'u9', full_name: 'Ada', email: 'ada@acme.test' }, error: null });
    h.pushResult({ data: null, error: null, count: null });
    await expect(findUserPage({ userId: 'u9', pageSize: 50 })).rejects.toMatchObject({
      code: 'COUNT_UNRESOLVED',
    });
  });

  it('treats a real zero position count as page one (a verified first position)', async () => {
    h.pushResult({ data: { id: 'u9', full_name: 'Ada', email: 'ada@acme.test' }, error: null });
    h.pushResult({ data: null, error: null, count: 0 });
    await expect(findUserPage({ userId: 'u9', pageSize: 50 })).resolves.toMatchObject({ page: 1 });
  });
});
