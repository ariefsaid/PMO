/**
 * AgentRuntimeProvider — the SOLE importer of PmoNativeRuntime (D-A2-5, AC-AP-024).
 * Constructs one PmoNativeRuntime when the agentAssistant flag is on.
 * Provides runtime + panel open state to all consumers via AgentRuntimeContext.
 *
 * NFR-AP-SEC-001: only the session JWT is forwarded; never service-role/provider API key.
 * FR-AP-024/025.
 */
import React, { useMemo, useRef, useState, useCallback } from 'react';
import { AgentRuntimeContext } from './AgentRuntimeContext';
import type { AgentRuntime } from './port';
import { PmoNativeRuntime } from './pmoNativeRuntime';
import { useAuth } from '@/src/auth/useAuth';
import { isFeatureEnabled } from '@/src/lib/features';
import { trackAgentPanelOpened } from '@/src/lib/analytics';
import { safeTrack } from '@/src/lib/analytics/safeTrack';

interface AgentRuntimeProviderProps {
  children: React.ReactNode;
}

export const AgentRuntimeProvider: React.FC<AgentRuntimeProviderProps> = ({ children }) => {
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const pendingPrefillRef = useRef<string | null>(null);
  const [prefillVersion, setPrefillVersion] = useState(0);

  // Keep a mutable ref to the current session so getJwt always reads the latest
  // token even after Supabase silently refreshes it (~55 min interval).
  // Standard React pattern for stable callbacks that need the latest state
  // without the callback itself being re-created (see useAssistantPanel runIdRef).
  const sessionRef = useRef(session);
  sessionRef.current = session; // updated every render — no dep-array issue

  // Construct the runtime once (memoised) — only when the flag is on.
  // This is the ONLY place in the SPA that imports PmoNativeRuntime (port isolation).
  const runtime = useMemo<AgentRuntime | null>(() => {
    if (!isFeatureEnabled('agentAssistant')) return null;
    return new PmoNativeRuntime({
      // Read via the ref: always returns the current session token, never a
      // stale closure value from the first render (NFR-AP-SEC-001, FR-AP-025).
      getJwt: () => sessionRef.current?.access_token ?? '',
      fnUrl: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agent-chat`,
    });
    // sessionRef is stable (useRef returns the same object); no deps needed.
  }, []);

  const openPanel = useCallback((prefill?: string) => {
    const nextPrefill = typeof prefill === 'string' ? prefill.trim() : '';
    if (nextPrefill) {
      pendingPrefillRef.current = nextPrefill;
      setPrefillVersion((v) => v + 1);
    }
    setOpen(true);
    // GAP-1 (docs/plans/2026-07-03-agent-posthog-events.md §0): no scope-binding UI
    // entry point exists in this codebase yet — every real call site opens unscoped.
    safeTrack(() => trackAgentPanelOpened(false));
  }, []);
  const consumePrefill = useCallback(() => {
    const prefill = pendingPrefillRef.current;
    pendingPrefillRef.current = null;
    return prefill;
  }, []);
  const closePanel = useCallback(() => setOpen(false), []);
  const togglePanel = useCallback(() => setOpen((o) => !o), []);

  const ctxValue = useMemo(
    () => ({ runtime, open, openPanel, closePanel, togglePanel, prefillVersion, consumePrefill }),
    [runtime, open, openPanel, closePanel, togglePanel, prefillVersion, consumePrefill],
  );

  return (
    <AgentRuntimeContext.Provider value={ctxValue}>
      {children}
    </AgentRuntimeContext.Provider>
  );
};
