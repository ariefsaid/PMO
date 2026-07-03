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

interface AgentRuntimeProviderProps {
  children: React.ReactNode;
}

export const AgentRuntimeProvider: React.FC<AgentRuntimeProviderProps> = ({ children }) => {
  const { session } = useAuth();
  const [open, setOpen] = useState(false);

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

  const openPanel = useCallback(() => setOpen(true), []);
  const closePanel = useCallback(() => setOpen(false), []);
  const togglePanel = useCallback(() => setOpen((o) => !o), []);

  const ctxValue = useMemo(
    () => ({ runtime, open, openPanel, closePanel, togglePanel }),
    [runtime, open, openPanel, closePanel, togglePanel],
  );

  return (
    <AgentRuntimeContext.Provider value={ctxValue}>
      {children}
    </AgentRuntimeContext.Provider>
  );
};
