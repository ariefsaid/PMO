/**
 * AC-PLN-008 [Vitest] — the FE resolves switches from the DATABASE projection (FR-PLN-005).
 *
 * The point of this suite is the seam, not the rendering:
 *   - ONE repository call (`listOwn` → `resolved_org_features()`) feeds every `useFeature` caller —
 *     the FE never re-implements global → override → plan, and the revenue ownership rule arrives
 *     as `display_enabled` (FR-PLN-005a) instead of a second FE copy;
 *   - `display_enabled` is what gates the UI, so a key that is entitled but display-hidden stays
 *     hidden (the ERP-owned revenue case) and the reverse also holds;
 *   - core keys are always true and resolve immediately, without waiting for the read;
 *   - `agent_assistant` and `user_views` AND their deployment kill switch: an Operator cannot grant
 *     a capability the deployment turned off, and the kill switch still hides it everywhere.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { listOwnMock } = vi.hoisted(() => ({ listOwnMock: { fn: vi.fn() } }));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }),
}));

vi.mock('@/src/lib/repositories/admin', () => ({
  orgFeatureRepository: {
      listOwn: () => listOwnMock.fn(),
    },
}));

import { useFeature } from '../useFeature';
import { ENV_FEATURE_GATES } from '@/src/lib/features';

const makeWrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

/** The resolved set the RPC would return, expressed the way the DAL projects it. */
const resolved = (
  display: Record<string, boolean>,
  enabled: Record<string, boolean> = display,
  source: Record<string, string> = {},
) => ({
  display,
  states: Object.fromEntries(
    Object.keys(display).map((key) => [
      key,
      {
        enabled: enabled[key] ?? display[key],
        displayEnabled: display[key],
        source: source[key] ?? 'plan',
      },
    ]),
  ),
});

beforeEach(() => {
  listOwnMock.fn = vi.fn().mockResolvedValue(resolved({ incidents: false, crm: true }));
});

describe('AC-PLN-008 — useFeature reads the resolved projection', () => {
  it('AC-PLN-008: a key the database resolves off is off (no FE re-resolution)', async () => {
    const { result } = renderHook(() => useFeature('incidents'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('AC-PLN-008: a key the database resolves on is on', async () => {
    const { result } = renderHook(() => useFeature('crm'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('AC-PLN-008: every consumer shares ONE repository read', async () => {
    const { result } = renderHook(
      () => ({ crm: useFeature('crm'), incidents: useFeature('incidents'), timesheets: useFeature('timesheets') }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.crm).toBe(true));
    expect(listOwnMock.fn).toHaveBeenCalledTimes(1);
  });

  it('AC-PLN-008 / FR-PLN-005a: display_enabled gates the UI, so ERP-owned revenue stays hidden while entitlement is on', async () => {
    listOwnMock.fn = vi.fn().mockResolvedValue(
      resolved({ revenue: false }, { revenue: true }, { revenue: 'plan' }),
    );
    const { result } = renderHook(() => useFeature('revenue'), { wrapper: makeWrapper() });
    // The display answer is what a route/nav reads, even though the server would allow the write.
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('AC-PLN-008: an explicit override still shows (display_enabled true, source override)', async () => {
    listOwnMock.fn = vi.fn().mockResolvedValue(
      resolved({ revenue: true }, { revenue: true }, { revenue: 'override' }),
    );
    const { result } = renderHook(() => useFeature('revenue'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('AC-PLN-008: core keys are ALWAYS on and never wait for the read', () => {
    listOwnMock.fn = vi.fn(() => new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useFeature('projects'), { wrapper: makeWrapper() });
    expect(result.current).toBe(true);
  });

  it('AC-PLN-008: the deployment kill switch defeats a database ON for agent_assistant / user_views', async () => {
    // The two keys with a deployment gate: assert the AND from both sides.
    expect(ENV_FEATURE_GATES.agent_assistant).toBe('agentAssistant');
    expect(ENV_FEATURE_GATES.user_views).toBe('userViews');
    listOwnMock.fn = vi.fn().mockResolvedValue(
      resolved({ agent_assistant: true, user_views: true, incidents: true }),
    );
    const { result } = renderHook(
      () => ({ assistant: useFeature('agent_assistant'), views: useFeature('user_views'), incidents: useFeature('incidents') }),
      { wrapper: makeWrapper() },
    );
    // In the test environment VITE_FEATURES_AGENT_ASSISTANT is unset (off) and
    // VITE_FEATURES_USERVIEWS is unset (on by default), so exactly one of the two is defeated.
    await waitFor(() => expect(result.current.incidents).toBe(true));
    expect(result.current.assistant).toBe(false);
    expect(result.current.views).toBe(true);
  });
});
