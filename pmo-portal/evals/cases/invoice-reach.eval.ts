/**
 * #787 — assistant invoice reach, against the DEPLOYED agent (ADR-0052). Proposal-only: no case approves, so an
 * eval run never creates an ERP document (DD-AIN-9). Fixture contract: evals/README.md § "Invoice-reach fixture".
 */
import { contains, usesTool } from '../harness/scorers';
import { defineEvalSuite, runEvalSuite } from '../harness/runEval';

const RUNS = 10;
const MIN_PASSES = 9; // DD-AIN-9 — owner question 1

export default runEvalSuite(
  defineEvalSuite({
    name: 'assistant invoice reach (#787)',
    cases: [
      {
        name: 'AC-AIN-003 AC-AIN-001 "what\'s overdue this week" → whats_overdue with task + invoice links',
        prompt: "What's overdue this week?",
        runs: RUNS,
        minPasses: MIN_PASSES,
        expect: [
          usesTool('whats_overdue'),
          contains(/\]\(\/projects\/[0-9a-f-]{36}\/tasks\)/i),
          contains(/\]\(\/sales-invoices\?q=[^)]+\)/),
        ],
      },
    ],
  }),
);
