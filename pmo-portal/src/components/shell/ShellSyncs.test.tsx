import { describe, it, expect, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import React from 'react';

const h = vi.hoisted(() => ({ eligibility: 'pending' as 'pending' | 'eligible', listeners: new Set<() => void>(), ownershipCalls: 0 }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ role: 'Admin', currentUser: { id: 'u1', org_id: 'o1' } }) }));
vi.mock('@/src/hooks/useDemoEligibility', () => ({
  useDemoEligibility: () => React.useSyncExternalStore(
    (cb) => { h.listeners.add(cb); return () => h.listeners.delete(cb); },
    () => h.eligibility,
  ),
}));
vi.mock('@/src/hooks/useOwnershipCacheSync', () => ({ useOwnershipCacheSync: () => { h.ownershipCalls += 1; } }));

import { ShellSyncs, EligibleImpersonationProvider } from './ShellSyncs';

describe('shell perf: network hooks live in leaves, not in the provider chain root', () => {
  it('a demo-eligibility change re-renders the provider and its consumers only, never its (stable) children', () => {
    let childRenders = 0;
    const Child = () => { childRenders += 1; return null; };
    const children = <Child />;
    const Root: React.FC = () => <EligibleImpersonationProvider realRole="Admin">{children}</EligibleImpersonationProvider>;
    render(<Root />);
    const before = childRenders;
    act(() => { h.eligibility = 'eligible'; h.listeners.forEach((l) => l()); });
    expect(childRenders).toBe(before);
  });

  it('ShellSyncs mounts the ownership sync once and renders nothing', () => {
    h.ownershipCalls = 0;
    const { container } = render(<ShellSyncs />);
    expect(container).toBeEmptyDOMElement();
    expect(h.ownershipCalls).toBe(1);
  });
});
