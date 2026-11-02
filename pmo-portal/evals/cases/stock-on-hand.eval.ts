/**
 * #1721 — the demo question, against the DEPLOYED agent (ADR-0052). Pure read: query_stock is
 * confirm:false and the case approves nothing, so a run never writes stock data.
 * Fixture contract: evals/README.md § "Stock fixture (#1721)".
 */
import { contains, usesTool } from '../harness/scorers';
import { defineEvalSuite, runEvalSuite } from '../harness/runEval';

const RUNS = 10;
const MIN_PASSES = 9;

export default runEvalSuite(
  defineEvalSuite({
    name: 'assistant warehouse stock (#1721)',
    cases: [
      {
        name: '#1721 "what is the current stock of solar panel in the central warehouse?" → query_stock returns the stock-on-hand figure (80), not procurement quantities',
        prompt: 'What is the current stock of solar panel in the central warehouse?',
        runs: RUNS,
        minPasses: MIN_PASSES,
        expect: [usesTool('query_stock'), contains(/80(?!\d)/)],
      },
    ],
  }),
);
