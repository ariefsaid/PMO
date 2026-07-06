/**
 * Agent tool-selection eval — the first behavior-regression suite against the
 * DEPLOYED agent-chat loop on the weak prod model (`deepseek/deepseek-v4-flash`).
 *
 * ADR-0052 / FR-AT2-EV-001/003. AC-AT2-015 loop half.
 *
 * Each case POSTs a natural-language prompt to `${EVAL_AGENT_CHAT_URL}` as the test
 * user, then asserts the run used the expected tool(s) and the answer is grounded.
 * A regression ("the model stopped choosing `query_entity` for a list request")
 * turns this suite red in the nightly/`workflow_dispatch` eval job.
 *
 * This file runs ONLY under `npm run test:evals` (vitest.eval.config.ts). The
 * default project + `verify` EXCLUDE `evals/cases/**` (FR-AT2-EV-006) — a leaked
 * eval would need a live provider key + deployed target and flake the fast lane.
 *
 * Secrets (NFR-AT2-SEC-005): read from process env ONLY. If the env is not
 * provisioned, every case SKIPS gracefully (never a red on a missing secret).
 */
import { contains, usesTool } from '../harness/scorers';
import { defineEvalSuite, runEvalSuite } from '../harness/runEval';

export default runEvalSuite(
  defineEvalSuite({
    name: 'agent tool-selection (deepseek-v4-flash)',
    cases: [
      {
        // Anchor case — the load-bearing behavior: a list request selects query_entity.
        name: 'AC-AT2-015 asks for a list → uses query_entity and grounds the answer',
        prompt: 'List my companies.',
        expect: [usesTool('query_entity'), contains(/compan/i)],
      },
      {
        // A read of a different entity — still query_entity, still grounded.
        name: 'a projects list request uses query_entity',
        prompt: 'What projects do I have?',
        expect: [usesTool('query_entity'), contains(/project/i)],
      },
    ],
  }),
);
