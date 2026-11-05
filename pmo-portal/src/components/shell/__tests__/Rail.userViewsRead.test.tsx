/**
 * Request count: the rail is on every page, so its saved-views read runs only for an org that has the
 * user_views module (the hook gets the entitlement as `enabled`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: 'Executive', realRole: 'Executive', canImpersonate: false, viewAs: vi.fn() }),
}));
const { useUserViews, orgFeaturesState } = vi.hoisted(() => ({
  useUserViews: vi.fn((_enabled?: boolean) => ({ data: [], isPending: false, isError: false })),
  orgFeaturesState: { value: undefined as Record<string, boolean | undefined> | undefined },
}));
vi.mock('@/src/hooks/useUserViews', () => ({ useUserViews }));
vi.mock('@/src/hooks/useOrgFeatures', () => ({ useOrgFeatures: () => ({ data: orgFeaturesState.value }) }));
vi.mock('@/src/auth/useIsOperator', () => ({ useIsOperator: () => false }));
import { Rail } from '../Rail';

const renderRail = () => render(<MemoryRouter><Rail /></MemoryRouter>);

describe('Rail saved-views read', () => {
  beforeEach(() => useUserViews.mockClear());

  it('is not enabled for an org without the user_views module', () => {
    orgFeaturesState.value = { user_views: false };
    renderRail();
    expect(useUserViews).toHaveBeenCalled();
    expect(useUserViews.mock.calls.every(([enabled]) => enabled === false)).toBe(true);
  });

  it('is enabled for an org with the module', () => {
    orgFeaturesState.value = { user_views: true };
    renderRail();
    expect(useUserViews).toHaveBeenCalled();
    expect(useUserViews.mock.calls.every(([enabled]) => enabled === true)).toBe(true);
  });
});
