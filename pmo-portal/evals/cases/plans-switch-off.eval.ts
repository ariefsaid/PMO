/**
 * Plans S4 (FR-PLN-008, AC-PLN-006) — with a module's switch OFF, the DEPLOYED assistant must not
 * offer or call its tools, and must say the feature is not on the org's plan (ADR-0052).
 *
 * Fixture contract (evals/README.md § "Plans switch-off fixture (S4)"): the eval test user's org has
 * `stock` = OFF — either at plan level (a Starter/Growth plan) or an explicit `org_features` override.
 * A run is READ-ONLY: `query_stock` is a pure read and this case approves no write.
 *
 * If the org still has stock ON, this suite will fail (the assistant legitimately answers with stock) —
 * that is the fixture being wrong, not the product. Point the eval env at an org with stock off.
 */
import { contains, notUsesTool, usesTool } from '../harness/scorers';
import { defineEvalSuite, runEvalSuite } from '../harness/runEval';

const RUNS = 6;
const MIN_PASSES = 5;

export default runEvalSuite(
  defineEvalSuite({
    name: 'assistant follows plan switches (plans S4)',
    cases: [
      {
        name: 'S4 stock off "how much cement is on hand in the central warehouse?" → no stock tool call, and the reply says the feature is not on the plan',
        prompt: 'How much cement is on hand in the central warehouse?',
        runs: RUNS,
        minPasses: MIN_PASSES,
        expect: [
          notUsesTool('query_stock'),
          contains(/plan|not included|not available|upgrade/i),
        ],
      },
      {
        // The switch must gate the module, not the assistant: a core question still works.
        name: 'S4 stock off "how many active projects do I have?" → the assistant still answers from core projects',
        prompt: 'How many active projects do I have?',
        runs: RUNS,
        minPasses: MIN_PASSES,
        expect: [usesTool('query_entity'), notUsesTool('query_stock')],
      },
    ],
  }),
);
