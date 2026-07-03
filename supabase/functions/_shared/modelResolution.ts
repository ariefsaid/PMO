/**
 * modelResolution — resolves the model id for agent-chat / compose-view calls.
 * FR-MC-015, MC-OD-009 (single per-action override: AGENT_MODEL_COMPOSE only,
 * NOT the two-var AGENT_MODEL_CHAT/AGENT_MODEL_COMPOSE proposal in the spec).
 *
 * Pure: takes a plain object, not Deno.env — importable in Vitest (ADR-0039 dec 7).
 */

export const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

export interface ModelEnv {
  AGENT_MODEL_DEFAULT?: string;
  AGENT_MODEL_COMPOSE?: string;
}

export function resolveDefaultModel(env: ModelEnv): string {
  return env.AGENT_MODEL_DEFAULT || DEFAULT_MODEL;
}

export function resolveComposeModel(env: ModelEnv): string {
  return env.AGENT_MODEL_COMPOSE || resolveDefaultModel(env);
}
