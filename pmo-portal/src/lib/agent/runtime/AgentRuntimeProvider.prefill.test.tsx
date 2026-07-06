import React from 'react';
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AgentRuntimeProvider } from './AgentRuntimeProvider';
import { useAgentRuntimeContext } from './AgentRuntimeContext';

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({
    session: { access_token: 'test-jwt' },
    currentUser: null,
    role: null,
    loading: false,
    profileError: null,
    signInWithPassword: vi.fn(),
    signInWithMagicLink: vi.fn(),
    signOut: vi.fn(),
  }),
}));

vi.mock('./pmoNativeRuntime', () => ({
  PmoNativeRuntime: class {
    createRun = vi.fn();
    followUp = vi.fn();
    control = vi.fn();
    subscribe = vi.fn();
  },
}));

vi.mock('@/src/lib/features', () => ({
  isFeatureEnabled: (key: string) => key === 'agentAssistant',
  FEATURES: { agentAssistant: true },
}));

vi.mock('@/src/lib/analytics', () => ({ trackAgentPanelOpened: vi.fn() }));

describe('AgentRuntimeProvider prefill', () => {
  it('AC-AT2-008 openPanel(prefill) seeds composer; openPanel() unchanged', () => {
    let ctx: ReturnType<typeof useAgentRuntimeContext> | null = null;
    const Probe = () => {
      ctx = useAgentRuntimeContext();
      return <div data-testid="open-state">{ctx.open ? 'open' : 'closed'}</div>;
    };

    render(
      <AgentRuntimeProvider>
        <Probe />
      </AgentRuntimeProvider>,
    );

    act(() => ctx!.openPanel('over budget cases'));
    expect(ctx!.open).toBe(true);
    expect(ctx!.consumePrefill!()).toBe('over budget cases');
    expect(ctx!.consumePrefill!()).toBeNull();

    act(() => ctx!.closePanel());
    act(() => ctx!.openPanel());
    expect(ctx!.open).toBe(true);
    expect(ctx!.consumePrefill!()).toBeNull();
  });
});
