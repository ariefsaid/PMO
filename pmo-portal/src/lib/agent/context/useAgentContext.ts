/**
 * useAgentContext — the read/write hook over AgentContextProvider (ADR-0045 §3).
 * Falls back to a no-op/empty-context shape when rendered outside a provider
 * (mirrors the flag-off posture elsewhere in the agent runtime — never throws
 * for callers that haven't opted into live context yet).
 */
import { useContext } from 'react';
import { AgentContextContext, type AgentContextValue } from './agentContextInternal';

const NOOP_CONTEXT: AgentContextValue = {
  getContext: () => ({}),
  setEntity: () => {},
  setSelection: () => {},
};

export function useAgentContext(): AgentContextValue {
  const ctx = useContext(AgentContextContext);
  return ctx ?? NOOP_CONTEXT;
}
