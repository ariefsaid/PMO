/**
 * AgentNativeHost — E3 (ADR-0040, FR-407 / AC-407).
 *
 * Mounts agent-native's REAL UI (`<AgentNativeEmbedded>` from `@agent-native/core/client`) inside
 * the PMO shell, in the SAME React tree (not an iframe), behind a feature flag so the existing
 * `AssistantPanel` stays live during staged retirement (E8 removes it).
 *
 * E4 (ADR-0040, FR-410/411/412 / AC-410/411/412): wired the bidirectional context/nav bridge and
 * @-mentions. The host calls `usePmoContextBridge` to feed PMO's current screen/entity to the
 * agent, and `usePmoRouteBridge` to consume agent navigation commands and route PMO.
 *
 * Composition (verified API ref §1 + the proven pilot `embed/main.tsx`): `<AgentNativeEmbedded
 * surface="sidebar">` renders the agent sidebar docked right with the PMO shell composed as its
 * `children` (host content). Same-tree = the agent UI and PMO share providers, context, and the
 * React reconciliation root.
 *
 * BEHAVIOR:
 *   enabled=false (default, flag off) → renders children UNCHANGED. The agent-native client chunk
 *     is never imported (lazy + dynamic import), so the default bundle + every existing test is
 *     byte-for-byte unaffected.
 *   enabled=true (flag on) → activates the bearer handoff (writes the PMO session JWT where the
 *     SDK fetch interceptor reads it) and wraps children in the themed `<AgentNativeEmbedded>`.
 *
 * THEME: the host container carries `data-agent-native-host` + `pmo-agent-native-theme`; the
 * accompanying `agentNativeTheme.css` bridges PMO's `:root`/`.dark` tokens onto the shadcn-HSL var
 * names agent-native consumes (FR-409 / AC-409). G1 fidelity is judged live at E5.
 *
 * This component is PROPS-DRIVEN (`enabled`, `accessToken`) so it is fully unit-testable without
 * auth-context or env-flag mocking. App.tsx reads the feature flag + the Supabase session and
 * passes them in.
 */
import React, { Suspense, useEffect } from 'react';
import { activateEmbedAuth } from '@/src/lib/agent/embedAuth';
import { usePmoContextBridge } from '@/src/lib/agent-native/contextBridge';
import { usePmoRouteBridge } from '@/src/lib/agent-native/routeBridge';
import './agentNativeTheme.css';

// Lazy-load the heavy agent-native client ONLY when the embed is enabled. Keeps the default
// (flag-off) bundle free of the ~730 kB client chunk. The dynamic import is mocked in the unit
// test with a faithful same-tree, not-iframe stub.
const AgentNativeEmbedded = React.lazy(() =>
  import('@agent-native/core/client').then((m) => ({ default: m.AgentNativeEmbedded })),
);

export interface AgentNativeHostProps {
  /** True when the agentNativeEmbed feature flag is on (mounts the embed). */
  enabled: boolean;
  /** The PMO Supabase session access_token (forwarded as the bearer to the sidecar). */
  accessToken: string | null | undefined;
  children: React.ReactNode;
}

/** Inline fallback for the lazy agent surface (Suspense) — token-only, no raw values. */
const EmbedFallback: React.FC = () => (
  <div
    role="status"
    aria-live="polite"
    className="text-muted-foreground p-4 text-sm"
    data-testid="agent-native-embed-fallback"
  >
    Loading assistant…
  </div>
);

export const AgentNativeHost: React.FC<AgentNativeHostProps> = ({ enabled, accessToken, children }) => {
  // Bearer handoff: (re)publish the session JWT to the SDK interceptor whenever it changes.
  // No-op effect when disabled (the hook still runs but activateEmbedAuth is only reached on enable).
  useEffect(() => {
    if (!enabled) return;
    void activateEmbedAuth(accessToken ?? null);
  }, [enabled, accessToken]);

  // E4: Context IN bridge — feed PMO's current screen/entity to the agent.
  // Only active when the embed is enabled (feature flag check is inside the hook).
  usePmoContextBridge({ enabled });

  // E4: Nav OUT bridge — consume agent navigation commands and route PMO.
  // Only active when the embed is enabled (feature flag check is inside the hook).
  usePmoRouteBridge({ enabled });

  if (!enabled) {
    // Flag off → shell unchanged, zero agent-native code in the tree.
    return <>{children}</>;
  }

  // Flag on → themed embed wraps the shell (same React tree, not an iframe).
  return (
    <div data-agent-native-host className="pmo-agent-native-theme">
      <Suspense fallback={<EmbedFallback />}>
        <AgentNativeEmbedded surface="sidebar" position="right" defaultOpen>
          {children}
        </AgentNativeEmbedded>
      </Suspense>
    </div>
  );
};
