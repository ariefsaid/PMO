/**
 * #787 — assistant invoice reach, against the DEPLOYED agent (ADR-0052). Proposal-only: no case approves, so an
 * eval run never creates an ERP document (DD-AIN-9). Fixture contract: evals/README.md § "Invoice-reach fixture".
 */
import { contains, proposesAction, usesTool } from '../harness/scorers';
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
      {
        name: 'AC-AIN-003 AC-AIN-002 "invoice work order WO-EVAL-0001" → proposes the Draft at its value before tax',
        prompt: 'Invoice work order WO-EVAL-0001.',
        runs: RUNS,
        minPasses: MIN_PASSES,
        expect: [
          proposesAction('draft_invoice', (a) =>
            a.kind === 'prepared-draft-invoice' && (a.items as Array<{ rate: number }>)[0]?.rate === 1_000_000),
        ],
      },
      {
        name: 'AC-AIN-003 AC-AIN-002 "invoice milestone 2 on EVAL-P1 for 5,000,000" → proposes the Draft',
        prompt: 'Invoice milestone 2 on project EVAL-P1 for 5,000,000 before tax.',
        runs: RUNS,
        minPasses: MIN_PASSES,
        expect: [proposesAction('draft_invoice', (a) => (a.items as Array<{ rate: number }>)[0]?.rate === 5_000_000)],
      },
    ],
  }),
);
