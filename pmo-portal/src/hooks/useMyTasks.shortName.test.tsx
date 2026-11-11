import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const h = vi.hoisted(() => {
  const result = { value: { data: null as unknown, error: null as unknown } };
  const selects: unknown[] = [];
  const builder: Record<string, unknown> = {};
  builder.select = (s: unknown) => { selects.push(s); return builder; };
  builder.eq = () => builder;
  builder.is = () => builder;
  builder.range = () => builder;
  builder.order = () => builder;
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);
  return { from: vi.fn(() => builder), result, selects };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Engineer' }) }));

import { useMyTasks } from './useMyTasks';

describe('useMyTasks short names (AC-002 #1325)', () => {
  it('selects short_name and maps it to the shown project name, keeping the contractual title', async () => {
    h.result.value = {
      data: [
        { id: 't1', name: 'A', status: 'To Do', assignee_id: 'u1', project_id: 'p1', meeting_id: null, start_date: null, end_date: null, project: { name: 'Contractual Tower', short_name: 'Tower' } },
        { id: 't2', name: 'B', status: 'To Do', assignee_id: 'u1', project_id: 'p2', meeting_id: null, start_date: null, end_date: null, project: { name: 'Plain', short_name: null } },
      ],
      error: null,
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useMyTasks(), { wrapper: ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(String(h.selects[0])).toContain('short_name');
    expect(result.current.data?.[0]).toMatchObject({ project_name: 'Tower', project_contractual_name: 'Contractual Tower' });
    expect(result.current.data?.[1]).toMatchObject({ project_name: 'Plain' });
    expect(result.current.data?.[1].project_contractual_name).toBeUndefined();
  });
});
