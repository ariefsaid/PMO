/**
 * AgentContextProvider — live-context source for agent runs (ADR-0045 §3).
 *
 * Reads `route` from react-router-dom's useLocation(); exposes an OPT-IN
 * imperative setEntity/setSelection a host page CAN call when it has a
 * natural "selected entity" (e.g. a project detail page). No page is forced
 * to adopt this in v1 (a repo survey confirms no existing app-wide
 * "selected entity" seam exists yet — host pages hold local selection state).
 *
 * FR-ATC-015 (context on createRun/followUp); FR-ATC-019 (READ-ONLY — no
 * setter here drives router navigation; the provider only ever READS the
 * location, never writes it, so agent-context can never move the user).
 */
import React, { useCallback, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { RunContext } from '../runtime/port';
import { AgentContextContext, type AgentContextValue } from './agentContextInternal';

interface AgentContextProviderProps {
  children: React.ReactNode;
}

export const AgentContextProvider: React.FC<AgentContextProviderProps> = ({ children }) => {
  const location = useLocation();
  const [entity, setEntityState] = useState<{ type: string; id: string; label: string } | undefined>(undefined);
  const [selection, setSelectionState] = useState<unknown>(undefined);

  const setEntity = useCallback((next: { type: string; id: string; label: string } | undefined) => {
    setEntityState(next);
  }, []);
  const setSelection = useCallback((next: unknown) => {
    setSelectionState(next);
  }, []);

  // getContext is called imperatively (not a subscribed value) — it always
  // reads the LATEST route/entity/selection at call time (useAssistantPanel's
  // send()/openThread() call it right before createRun/followUp).
  const getContext = useCallback((): RunContext => {
    const ctx: RunContext = { route: location.pathname };
    if (entity) ctx.entity = entity;
    if (selection !== undefined) ctx.selection = selection;
    return ctx;
  }, [location.pathname, entity, selection]);

  const value = useMemo<AgentContextValue>(
    () => ({ getContext, setEntity, setSelection }),
    [getContext, setEntity, setSelection],
  );

  return <AgentContextContext.Provider value={value}>{children}</AgentContextContext.Provider>;
};
