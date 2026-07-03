/**
 * Internal React context object shared by AgentContextProvider (write side) and
 * useAgentContext (read side) — kept in its own module so fast-refresh/HMR does
 * not warn about a non-component export living alongside components.
 * ADR-0045 §3.
 */
import React from 'react';
import type { RunContext } from '../runtime/port';

export interface AgentContextValue {
  /** Returns the current RunContext snapshot (route + entity + selection). */
  getContext: () => RunContext;
  /**
   * Opt-in imperative setter a host page MAY call when it has a natural
   * "selected entity" (e.g. a detail page). No page is forced to adopt this in
   * v1 — omitted, getContext().entity stays undefined (FR-ATC-015).
   */
  setEntity: (entity: { type: string; id: string; label: string } | undefined) => void;
  /** Reserved — not populated in v1 (RunContext.selection is a typed escape hatch only). */
  setSelection: (selection: unknown) => void;
}

export const AgentContextContext = React.createContext<AgentContextValue | null>(null);
