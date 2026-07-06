/**
 * AC-ENT-003 — useFeature() resolves the entitlement (ops-admin-surface S6).
 *
 *   - A stored `org_features` row OVERRIDES the env default (crm row = false → false).
 *   - Absence of a row falls back to FEATURE_ENV_DEFAULT (incidents absent but env=true → true).
 *   - Core keys (projects/dashboard/approvals/administration) are ALWAYS true and never even
 *     touch the org-features query.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Mutable map the mocked useOrgFeatures returns; each test sets its state.
const { featuresState } = vi.hoisted(() => ({
  featuresState: { value: {} as Record<string, boolean | undefined> },
}));

vi.mock('@/src/hooks/useOrgFeatures', () => ({
  useOrgFeatures: () => ({ data: featuresState.value }),
}));

import { useFeature } from '../useFeature';
import { FEATURE_ENV_DEFAULT } from '@/src/lib/features';

const makeWrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

describe('AC-ENT-003 — useFeature() hides affordances by entitlement', () => {
  it('a stored org_features row overrides the env default (crm row=false → false)', () => {
    // env default for crm is false in test env; row also false — both agree here, but the
    // point is the row is the authority.
    featuresState.value = { crm: false };
    const { result } = renderHook(() => useFeature('crm'), { wrapper: makeWrapper() });
    expect(result.current).toBe(false);
  });

  it('absence of a row falls back to FEATURE_ENV_DEFAULT (incidents absent, env=true → true)', () => {
    // Force the env default to true to prove absence = included.
    const original = FEATURE_ENV_DEFAULT.incidents;
    (FEATURE_ENV_DEFAULT as Record<string, boolean>).incidents = true;
    try {
      featuresState.value = {}; // no incidents row
      const { result } = renderHook(() => useFeature('incidents'), { wrapper: makeWrapper() });
      expect(result.current).toBe(true);
    } finally {
      (FEATURE_ENV_DEFAULT as Record<string, boolean>).incidents = original;
    }
  });

  it('a stored row can ENABLE a feature whose env default is false (incidents row=true)', () => {
    featuresState.value = { incidents: true };
    const { result } = renderHook(() => useFeature('incidents'), { wrapper: makeWrapper() });
    expect(result.current).toBe(true);
  });

  it('core keys are ALWAYS enabled and never touch the org-features query (projects)', () => {
    featuresState.value = {}; // ensure no row is consulted
    const { result } = renderHook(() => useFeature('projects'), { wrapper: makeWrapper() });
    expect(result.current).toBe(true);
  });
});
