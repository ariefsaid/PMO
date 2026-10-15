import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const harness = vi.hoisted(() => ({ org: 'org-a', context: vi.fn() }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: harness.org ? { org_id: harness.org } : null }),
}));
vi.mock('@/src/lib/repositories', () => ({
  repositories: { fxRates: { context: harness.context } },
}));
import { useFxOrgDay } from './useFxOrgDay';

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

describe('organization-local FX day', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.setSystemTime(new Date('2026-10-09T17:30:00.000Z'));
    harness.org = 'org-a';
    harness.context.mockResolvedValue({ currency: 'IDR', timezone: 'Asia/Jakarta' });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('AC-FX-004 derives latest day from org timezone, not profile timezone', async () => {
    const { wrapper } = setup();
    const result = renderHook(() => useFxOrgDay(true), { wrapper });
    await waitFor(() => expect(result.result.current.day).toBe('2026-10-10'));
    expect(harness.context).toHaveBeenCalledTimes(1);
  });

  it('keeps context errors distinct rather than guessing UTC', async () => {
    harness.context.mockRejectedValueOnce(new Error('context unavailable'));
    const { wrapper } = setup();
    const result = renderHook(() => useFxOrgDay(true), { wrapper });
    await waitFor(() => expect(result.result.current.isError).toBe(true));
    expect(result.result.current.day).toBeNull();
  });

  it('AC-FX-004 retries both the organization context and resolved day query', async () => {
    const { wrapper } = setup();
    const result = renderHook(() => useFxOrgDay(true), { wrapper });
    await waitFor(() => expect(result.result.current.day).toBe('2026-10-10'));

    result.result.current.retry();
    await waitFor(() => expect(harness.context).toHaveBeenCalledTimes(2));
  });

  it('does not start the minute ticker for historical equivalents', async () => {
    const { client, wrapper } = setup();
    renderHook(() => useFxOrgDay(false), { wrapper });
    await waitFor(() => expect(harness.context).toHaveBeenCalledTimes(1));
    expect(
      client.getQueryCache().find({ queryKey: ['fx-org-day', 'org-a', 'Asia/Jakarta'] }),
    ).toBeUndefined();
  });
});
