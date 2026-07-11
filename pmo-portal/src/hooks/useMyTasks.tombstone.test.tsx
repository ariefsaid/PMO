import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

/**
 * AC-CUA-002 (supports) — Slice C, C5c. The cross-project My Tasks list must exclude tombstoned
 * rows (a ClickUp-native delete, C3) the same way `listTasks`/`getTask` do (C5/C5b), while keeping
 * the existing assignee/project-name join behavior byte-for-byte for live rows.
 */

const h = vi.hoisted(() => {
  const result = { value: { data: null as unknown, error: null as unknown } };
  const calls = { from: [] as unknown[], select: [] as unknown[], eq: [] as unknown[], is: [] as unknown[], order: [] as unknown[] };
  const builder: Record<string, unknown> = {};
  const chain = (name: keyof typeof calls) => (...args: unknown[]) => {
    (calls[name] as unknown[]).push(args.length === 1 ? args[0] : args);
    return builder;
  };
  builder.select = chain('select');
  builder.eq = chain('eq');
  builder.is = chain('is');
  builder.order = chain('order');
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);
  const from = vi.fn((table: string) => {
    calls.from.push(table);
    return builder;
  });
  return { from, calls, result };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Engineer' }),
}));

import { useMyTasks } from './useMyTasks';

const wrap = (client: QueryClient) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
const freshClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

beforeEach(() => {
  h.from.mockClear();
  h.calls.from.length = 0;
  h.calls.select.length = 0;
  h.calls.eq.length = 0;
  h.calls.is.length = 0;
  h.calls.order.length = 0;
  h.result.value = { data: null, error: null };
});

describe('useMyTasks excludes tombstoned rows (C5c)', () => {
  it('filters .is(tombstoned_at, null) and keeps the join shape for a live row byte-for-byte', async () => {
    h.result.value = {
      data: [
        {
          id: 't1',
          name: 'Survey site',
          status: 'To Do',
          assignee_id: 'u1',
          project_id: 'p1',
          start_date: null,
          end_date: null,
          project: { name: 'Acme Tower' },
        },
      ],
      error: null,
    };
    const { result } = renderHook(() => useMyTasks(), { wrapper: wrap(freshClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(h.calls.from).toEqual(['tasks']);
    expect(h.calls.eq).toContainEqual(['assignee_id', 'u1']);
    expect(h.calls.is).toContainEqual(['tombstoned_at', null]);

    expect(result.current.data).toEqual([
      {
        id: 't1',
        name: 'Survey site',
        status: 'To Do',
        assignee_id: 'u1',
        project_id: 'p1',
        project_name: 'Acme Tower',
        start_date: null,
        end_date: null,
      },
    ]);
  });

  it('a tombstoned row is excluded at the query level — the list is empty when the mock returns none', async () => {
    h.result.value = { data: [], error: null };
    const { result } = renderHook(() => useMyTasks(), { wrapper: wrap(freshClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});
