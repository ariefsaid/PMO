/**
 * AC-407 (mount) + AC-409 (theme bridge) — FR-407 / FR-409.
 *
 * AC-407: Given the assistant slot, When the feature flag is enabled, Then <AgentNativeEmbedded>
 *         renders in the PMO shell and NOT in an iframe. Flag off → no embed, shell unchanged.
 * AC-409: When the embed renders, the host container carries the PMO token-bridge surface
 *         (data-agent-native-host + pmo-agent-native-theme) for light/dark theming.
 *
 * The heavy `@agent-native/core/client` is mocked with a FAITHFUL CONTRACT STUB: it renders a
 * real in-tree DOM node (data-testid + data-surface) that composes `children`, explicitly NOT an
 * iframe. This verifies PMO's HOST wiring (the component under test) — flag branching, child
 * composition, theme-surface mount — without spinning up the real client's network/assistant-ui
 * layer (unsuitable for a fast unit test). The real client's same-tree, non-iframe contract is
 * verified against its installed types; the stub encodes that verified contract.
 *
 * Owning layer: Unit.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AgentNativeHost } from '@/src/components/agent/AgentNativeHost';
import { EMBED_TOKEN_STORAGE_KEY } from '@/src/lib/agent/embedAuth';

// Faithful contract stub for the heavy third-party client. Encodes the verified API-ref contract:
// same-tree render (a div, not an iframe), children compose inside, surface forwarded.
vi.mock('@agent-native/core/client', () => ({
  AgentNativeEmbedded: ({ children, surface }: { children?: React.ReactNode; surface?: string }) =>
    React.createElement(
      'div',
      { 'data-testid': 'agent-native-embedded', 'data-surface': surface },
      children,
    ),
  ensureEmbedAuthFetchInterceptor: vi.fn(),
}));

describe('AC-407 — AgentNativeHost mounts <AgentNativeEmbedded> in-tree (not an iframe)', () => {
  beforeEach(() => sessionStorage.clear());

  it('flag ON: renders <AgentNativeEmbedded> in the same React tree with the host shell as children', async () => {
    render(
      <AgentNativeHost enabled accessToken="jwt">
        <div data-testid="pmo-shell-content">PMO</div>
      </AgentNativeHost>,
    );

    // The embedded surface mounts (lazy resolves via the mocked dynamic import).
    const embed = await screen.findByTestId('agent-native-embedded');
    expect(embed).toBeDefined();
    // surface="sidebar" — the right-docked composition per the design guidance.
    expect(embed.getAttribute('data-surface')).toBe('sidebar');

    // Host shell content composes INSIDE the embed (same React tree, not a remote iframe).
    const hostContent = screen.getByTestId('pmo-shell-content');
    expect(embed.contains(hostContent)).toBe(true);
  });

  it('flag ON: the embedded surface is a real DOM node, NEVER an <iframe>', async () => {
    const { container } = render(
      <AgentNativeHost enabled accessToken="jwt">
        <div>shell</div>
      </AgentNativeHost>,
    );
    await screen.findByTestId('agent-native-embedded');
    expect(container.querySelector('iframe')).toBeNull();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('flag OFF: does NOT mount the embed; renders children unchanged (staged retirement keeps AssistantPanel live)', () => {
    render(
      <AgentNativeHost enabled={false} accessToken="jwt">
        <div data-testid="pmo-shell-content">PMO</div>
      </AgentNativeHost>,
    );

    expect(screen.queryByTestId('agent-native-embedded')).toBeNull();
    expect(screen.queryByTestId('agent-native-embed-fallback')).toBeNull();
    // Shell content still renders (the app is byte-identical when the flag is off).
    expect(screen.getByTestId('pmo-shell-content')).toBeDefined();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('flag ON: activates the bearer handoff with the PMO session token', async () => {
    render(
      <AgentNativeHost enabled accessToken="jwt-session-token">
        <div>shell</div>
      </AgentNativeHost>,
    );
    await waitFor(() => {
      expect(sessionStorage.getItem(EMBED_TOKEN_STORAGE_KEY)).toBe('jwt-session-token');
    });
  });

  it('flag ON without a session: does not publish a bearer (clean, no leaked empty token)', async () => {
    render(
      <AgentNativeHost enabled accessToken={null}>
        <div>shell</div>
      </AgentNativeHost>,
    );
    // Give the effect a tick; nothing should be written.
    await waitFor(() => {
      expect(sessionStorage.getItem(EMBED_TOKEN_STORAGE_KEY)).toBeNull();
    });
  });
});

describe('AC-409 — AgentNativeHost carries the PMO token-bridge theme surface', () => {
  beforeEach(() => sessionStorage.clear());

  it('flag ON: the embed container carries the PMO token-bridge attributes/class', async () => {
    const { container } = render(
      <AgentNativeHost enabled accessToken="jwt">
        <div>shell</div>
      </AgentNativeHost>,
    );
    await screen.findByTestId('agent-native-embedded');

    const themeSurface = container.querySelector('[data-agent-native-host]');
    expect(themeSurface).not.toBeNull();
    expect(themeSurface?.classList.contains('pmo-agent-native-theme')).toBe(true);
  });

  it('flag OFF: no theme-bridge surface is mounted', () => {
    const { container } = render(
      <AgentNativeHost enabled={false} accessToken="jwt">
        <div>shell</div>
      </AgentNativeHost>,
    );
    expect(container.querySelector('[data-agent-native-host]')).toBeNull();
  });
});
