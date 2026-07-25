/**
 * AgentContextProvider — live-context source for agent runs (ADR-0045 §3).
 *
 * Reads `route` from react-router's useLocation(); exposes an OPT-IN
 * imperative setEntity/setSelection a host page CAN call when it has a
 * natural "selected entity" (e.g. a project detail page). No page is forced
 * to adopt this in v1 (a repo survey confirms no existing app-wide
 * "selected entity" seam exists yet — host pages hold local selection state).
 *
 * FR-ATC-015 (context on createRun/followUp); FR-ATC-019 (READ-ONLY — no
 * setter here drives router navigation; the provider only ever READS the
 * location, never writes it, so agent-context can never move the user).
 */
import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import type { RunContext } from '../runtime/port';
import { AgentContextContext, type AgentContextValue } from './agentContextInternal';

interface AgentContextProviderProps {
  children: React.ReactNode;
}

export const AgentContextProvider: React.FC<AgentContextProviderProps> = ({ children }) => {
  const location = useLocation();
  const [, setEntityState] = useState<{ type: string; id: string; label: string } | undefined>(undefined);
  const [, setSelectionState] = useState<unknown>(undefined);
  const routeRef = useRef(location.pathname);
  const entityRef = useRef<{ type: string; id: string; label: string } | undefined>(undefined);
  const selectionRef = useRef<unknown>(undefined);
  useLayoutEffect(() => {
    routeRef.current = location.pathname;
  }, [location.pathname]);

  const setEntity = useCallback((next: { type: string; id: string; label: string } | undefined) => {
    entityRef.current = next;
    setEntityState(next);
  }, []);
  const setSelection = useCallback((next: unknown) => {
    selectionRef.current = next;
    setSelectionState(next);
  }, []);

  // getContext is called imperatively (not a subscribed value) — it always
  // reads refs holding the LATEST route/entity/selection at call time. Reading
  // refs is deliberate: callbacks captured before a host page calls setEntity
  // must not send a stale context on the first immediate Assistant turn.
  const getContext = useCallback((): RunContext => {
    const ctx: RunContext = { route: routeRef.current };
    if (entityRef.current) ctx.entity = entityRef.current;
    if (selectionRef.current !== undefined) ctx.selection = selectionRef.current;
    return ctx;
  }, []);

  // A fresh value notifies consumers after the state setters above trigger a
  // provider render; getContext itself stays stable and safe for stale callers.
  const value: AgentContextValue = { getContext, setEntity, setSelection };

  return <AgentContextContext.Provider value={value}>{children}</AgentContextContext.Provider>;
};
