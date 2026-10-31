import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { renderHook, waitFor, cleanup, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const h = vi.hoisted(() => ({
  getConnection: vi.fn(),
  listMasterRecords: vi.fn(),
  setup: vi.fn(),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-a' } }) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { odoo: h } }));

import { useOdooConnection, useMasterRecords, useOdooSetup } from './useOdoo';

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const mk = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
};

it('every Odoo query key includes the org id', async () => {
  const { client, wrapper } = mk();
  h.getConnection.mockResolvedValue({ status: 'active' });
  h.listMasterRecords.mockResolvedValue({ rows: [], total: 0 });
  const a = renderHook(() => useOdooConnection(), { wrapper });
  const b = renderHook(() => useMasterRecords({ kind: 'product', page: 1, pageSize: 50 }), { wrapper });
  await waitFor(() => expect(a.result.current.isSuccess && b.result.current.isSuccess).toBe(true));
  const keys = client.getQueryCache().getAll().map((q) => q.queryKey);
  expect(keys).toHaveLength(2);
  for (const k of keys) { expect(k[0]).toBe('odoo'); expect(k).toContain('org-a'); }
});

it('a setup action invalidates the Odoo and integration-health families', async () => {
  const { client, wrapper } = mk();
  const spy = vi.spyOn(client, 'invalidateQueries');
  h.setup.mockResolvedValue({ ok: true });
  const { result } = renderHook(() => useOdooSetup('recheck'), { wrapper });
  await act(async () => { await result.current.mutateAsync({}); });
  expect(h.setup).toHaveBeenCalledWith('recheck', {});
  const keys = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
  expect(keys).toContainEqual(['odoo']);
  expect(keys).toContainEqual(['integrations', 'health', 'org-a']);
  expect(keys).toContainEqual(['integrations', 'bindings', 'org-a']);
});
