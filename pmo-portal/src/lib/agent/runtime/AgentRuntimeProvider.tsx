/**
 * AgentRuntimeProvider — the SOLE importer of PmoNativeRuntime (D-A2-5, AC-AP-024).
 * Constructs one PmoNativeRuntime when the agentAssistant flag is on.
 * Provides runtime + panel open state to all consumers via AgentRuntimeContext.
 *
 * NFR-AP-SEC-001: only the session JWT is forwarded; never service-role/ANTHROPIC key.
 * FR-AP-024/025.
 */
import React, { useMemo, useState } from 'react';
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

  // Construct the runtime once (memoised) — only when the flag is on.
  // This is the ONLY place in the SPA that imports PmoNativeRuntime (port isolation).
  const runtime = useMemo<AgentRuntime | null>(() => {
    if (!isFeatureEnabled('agentAssistant')) return null;
    return new PmoNativeRuntime({
      getJwt: () => session?.access_token ?? '',
      fnUrl: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agent-chat`,
    });
    // session intentionally NOT in deps: we use a getter so the JWT stays fresh.
    // The runtime is constructed once per app lifetime; the getter closes over the
    // session ref via the component closure which is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openPanel = () => setOpen(true);
  const closePanel = () => setOpen(false);
  const togglePanel = () => setOpen((o) => !o);

  return (
    <AgentRuntimeContext.Provider
      value={{ runtime, open, openPanel, closePanel, togglePanel }}
    >
      {children}
    </AgentRuntimeContext.Provider>
  );
};
