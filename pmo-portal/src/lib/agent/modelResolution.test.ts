/**
 * AC-MC-018: default model resolution when no env vars set.
 * AC-MC-019: AGENT_MODEL_COMPOSE overrides AGENT_MODEL_DEFAULT for compose-view.
 *
 * Test-location convention (standing rule — see openRouterModelClient.test.ts header):
 * edge-fn logic tests live under pmo-portal/, implementation stays in supabase/functions/.
 */
import { it, expect } from 'vitest';
import { DEFAULT_MODEL, resolveDefaultModel, resolveComposeModel } from '../../../../supabase/functions/_shared/modelResolution';

it('AC-MC-018 resolves to deepseek/deepseek-v4-flash when no env vars are set', () => {
  expect(resolveDefaultModel({})).toBe('deepseek/deepseek-v4-flash');
  expect(resolveDefaultModel({})).toBe(DEFAULT_MODEL);
  expect(resolveComposeModel({})).toBe(DEFAULT_MODEL);
});

it('AC-MC-019 AGENT_MODEL_COMPOSE overrides AGENT_MODEL_DEFAULT for compose-view resolution', () => {
  const env = { AGENT_MODEL_DEFAULT: 'some/other-model', AGENT_MODEL_COMPOSE: 'deepseek/deepseek-v4-flash' };
  expect(resolveComposeModel(env)).toBe('deepseek/deepseek-v4-flash');
  expect(resolveDefaultModel(env)).toBe('some/other-model');
});
