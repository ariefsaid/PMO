/**
 * AC-M365-011 — the m365_integration entitlement resolves default-OFF, ON when entitled.
 * Default-off (env default false) is what keeps the integration hidden until an Operator entitles it.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { featuresState } = vi.hoisted(() => ({
  featuresState: { value: {} as Record<string, boolean | undefined> },
}));
vi.mock('@/src/hooks/useOrgFeatures', () => ({
  useOrgFeatures: () => ({ data: featuresState.value }),
}));

import { useFeature } from '../useFeature';

const makeWrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
};

describe('AC-M365-011 — m365_integration entitlement resolution', () => {
  it('AC-M365-011: default-OFF when the org has no org_features row', () => {
    featuresState.value = {};
    const { result } = renderHook(() => useFeature('m365_integration'), { wrapper: makeWrapper() });
    expect(result.current).toBe(false);
  });

  it('AC-M365-011: ON when the org has the m365_integration row enabled', () => {
    featuresState.value = { m365_integration: true };
    const { result } = renderHook(() => useFeature('m365_integration'), { wrapper: makeWrapper() });
    expect(result.current).toBe(true);
  });
});
