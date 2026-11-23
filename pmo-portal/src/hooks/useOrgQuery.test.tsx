import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const harness = vi.hoisted(() => ({ org: 'org-a' as string | undefined, read: vi.fn() }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: harness.org ? { org_id: harness.org } : null }),
}));
import { useOrgQuery } from './useOrgQuery';

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

function optionsOf(client: QueryClient, key: unknown[]): { staleTime?: number; gcTime?: number } | undefined {
  const query = client.getQueryCache().find({ queryKey: key });
  return query ? (query.options as { staleTime?: number; gcTime?: number }) : undefined;
}

describe('useOrgQuery — one org-scoped read', () => {
  beforeEach(() => {
    harness.org = 'org-a';
    harness.read.mockReset().mockResolvedValue('row');
  });
  afterEach(cleanup);

  it('keys the read by the org id, spliced after the root, and waits for the org to be known', async () => {
    const { client, wrapper } = setup();
    const result = renderHook(() => useOrgQuery(['billing-board', 'p1'], harness.read), { wrapper });
    await waitFor(() => expect(result.result.current.data).toBe('row'));
    expect(client.getQueryCache().find({ queryKey: ['billing-board', 'org-a', 'p1'] })).toBeDefined();
    expect(harness.read).toHaveBeenCalledTimes(1);
  });

  it('does not fetch while the org is unknown, and fetches once it is known', async () => {
    harness.org = undefined;
    const { wrapper } = setup();
    const result = renderHook(() => useOrgQuery(['billing-board'], harness.read), { wrapper });
    expect(result.result.current.fetchStatus).toBe('idle');
    expect(harness.read).not.toHaveBeenCalled();
  });

  it('stays off while the caller gate is closed, even with the org known', async () => {
    const { wrapper } = setup();
    const result = renderHook(() => useOrgQuery(['billing-board'], harness.read, { enabled: false }), { wrapper });
    expect(result.result.current.fetchStatus).toBe('idle');
    expect(harness.read).not.toHaveBeenCalled();
  });

  it("'session' caches the read for the whole session (SESSION_QUERY_OPTIONS)", async () => {
    const { client, wrapper } = setup();
    renderHook(() => useOrgQuery(['clearance', 'enabled'], harness.read, { staleness: 'session' }), { wrapper });
    const options = optionsOf(client, ['clearance', 'org-a', 'enabled']);
    expect(options?.staleTime).toBe(Infinity);
    expect(options?.gcTime).toBe(Infinity);
  });

  it("'live' refreshes the read on the shared live window", async () => {
    const { client, wrapper } = setup();
    renderHook(() => useOrgQuery(['work-in-hand'], harness.read, { staleness: 'live' }), { wrapper });
    expect(optionsOf(client, ['work-in-hand', 'org-a'])?.staleTime).toBe(60_000);
  });

  it('without a named staleness keeps the react-query default (always fresh)', async () => {
    const { client, wrapper } = setup();
    renderHook(() => useOrgQuery(['crews'], harness.read), { wrapper });
    expect(optionsOf(client, ['crews', 'org-a'])?.staleTime).toBeUndefined();
  });

  it('keeps every tail element of the key in order', async () => {
    const { client, wrapper } = setup();
    renderHook(
      () => useOrgQuery(['safety-days', 'wo-days', 'wo-1', '2026-12-15', '2026-12-21'], harness.read),
      { wrapper },
    );
    await waitFor(() => expect(harness.read).toHaveBeenCalled());
    expect(
      client.getQueryCache().find({ queryKey: ['safety-days', 'org-a', 'wo-days', 'wo-1', '2026-12-15', '2026-12-21'] }),
    ).toBeDefined();
  });
});
