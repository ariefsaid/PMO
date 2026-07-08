/**
 * AgentRuntimeContext — the React context seam between the shell provider and
 * the panel/hooks. Holds only the AgentRuntime port type — no concrete adapter.
 *
 * NFR-AP-SEC-003: this file imports ONLY from port.ts. No adapter import here.
 * FR-AP-024: panel and hooks read the runtime via useAgentRuntime(), never
 * importing PmoNativeRuntime directly.
 */
import React from 'react';
import type { AgentRuntime } from './port';

export interface AgentRuntimeContextValue {
  runtime: AgentRuntime | null;
  /** Panel open/closed — lifted to the provider so Rail + ⌘J + panel share one source (D-A2-5/R-OPEN-STATE). */
  open: boolean;
  openPanel(prefill?: string): void;
  closePanel(): void;
  togglePanel(): void;
  /** Increments when a new one-shot prefill is available. */
  prefillVersion?: number;
  /** One-shot draft prefill consumed by AssistantPanel after openPanel(prefill). */
  consumePrefill?: () => string | null;
  /** git SHA of the deployed agent-chat fn (from its x-deploy-version header); null until the first turn. */
  edgeVersion?: string | null;
}

export const AgentRuntimeContext = React.createContext<AgentRuntimeContextValue>({
  runtime: null,
  open: false,
  openPanel: () => {},
  closePanel: () => {},
  togglePanel: () => {},
  prefillVersion: 0,
  consumePrefill: () => null,
  edgeVersion: null,
});

/**
 * useAgentRuntime — reads the AgentRuntime from context.
 * Throws if called outside an AgentRuntimeProvider with the agentAssistant flag on.
 */
export function useAgentRuntime(): AgentRuntime {
  const { runtime } = React.useContext(AgentRuntimeContext);
  if (!runtime) {
    throw new Error(
      'useAgentRuntime must be used within an AgentRuntimeProvider with the agentAssistant flag on',
    );
  }
  return runtime;
}

/**
 * useAgentRuntimeContext — full context value (runtime + open state controls).
 * Used by the panel and hooks to read/drive the shared open state.
 */
export function useAgentRuntimeContext(): AgentRuntimeContextValue {
  return React.useContext(AgentRuntimeContext);
}
