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
import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import type { RunContext } from '../runtime/port';
import {
  AgentContextChangeContext,
  AgentContextContext,
  AgentContextPublisherContext,
  type AgentContextValue,
} from './agentContextInternal';

interface AgentContextProviderProps {
  children: React.ReactNode;
}

export const AgentContextProvider: React.FC<AgentContextProviderProps> = ({ children }) => {
  const location = useLocation();
  const [changes, setChanges] = useState(0);
  const routeRef = useRef(location.pathname);
  const entityRef = useRef<{ type: string; id: string; label: string } | undefined>(undefined);
  const selectionRef = useRef<unknown>(undefined);
  useLayoutEffect(() => {
    routeRef.current = location.pathname;
  }, [location.pathname]);

  const setEntity = useCallback((next: { type: string; id: string; label: string } | undefined) => {
    const previous = entityRef.current;
    entityRef.current = next;
    // Re-publishing the same entity (every detail mount does) is not a change.
    if (previous?.type !== next?.type || previous?.id !== next?.id || previous?.label !== next?.label) setChanges((count) => count + 1);
  }, []);
  const setSelection = useCallback((next: unknown) => {
    selectionRef.current = next;
    setChanges((count) => count + 1);
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

  // The value is stable: readers that render from the context subscribe to `change` instead.
  const value = useMemo<AgentContextValue>(() => ({ getContext, setEntity, setSelection }), [getContext, setEntity, setSelection]);
  const change = `${location.pathname}#${changes}`;

  const publisher = useMemo(() => ({ setEntity, setSelection }), [setEntity, setSelection]);

  return (
    <AgentContextPublisherContext.Provider value={publisher}>
      <AgentContextContext.Provider value={value}>
        <AgentContextChangeContext.Provider value={change}>{children}</AgentContextChangeContext.Provider>
      </AgentContextContext.Provider>
    </AgentContextPublisherContext.Provider>
  );
};
