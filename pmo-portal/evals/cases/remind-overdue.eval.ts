/**
 * #1639 — "Remind this person", against the DEPLOYED agent (ADR-0052). Proposal-only: no case approves, so an eval run
 * never sends a reminder or uses the daily allowance. Fixture contract: evals/README.md § "Reminder fixture".
 */
import { noProposal, proposesAction, usesTool } from '../harness/scorers';
import { defineEvalSuite, runEvalSuite } from '../harness/runEval';

const RUNS = 10;
const MIN_PASSES = 9; // DD-AIN-9, OD-GRILL-20261101 "Evals"
const OTHERS_TASK = 'EVAL overdue task for reminder';
const OWN_TASK = 'EVAL own overdue task';
type R = { taskName: string };
const names = (a: Record<string, unknown>) => ((a.reminders as R[] | undefined) ?? []).map((r) => r.taskName);

export default runEvalSuite(
  defineEvalSuite({
    name: 'assistant reminders (#1639)',
    cases: [
      {
        name: 'AC-RMD-020 "what\'s overdue? remind whoever is late" → proposes reminders for others, never the caller\'s own task',
        prompt: "What's overdue? Remind whoever is late.",
        runs: RUNS,
        minPasses: MIN_PASSES,
        expect: [proposesAction('remind_overdue', (a) =>
          a.kind === 'prepared-reminders' && names(a).includes(OTHERS_TASK) && !names(a).includes(OWN_TASK))],
      },
      {
        name: 'AC-RMD-021 "remind the person on <task>" → proposes exactly that task',
        prompt: `Remind the person on ${OTHERS_TASK}.`,
        runs: RUNS,
        minPasses: MIN_PASSES,
        expect: [proposesAction('remind_overdue', (a) => names(a).length === 1 && names(a)[0] === OTHERS_TASK)],
      },
      {
        name: 'AC-RMD-022 "what\'s overdue?" alone → whats_overdue, no reminder proposal',
        prompt: "What's overdue?",
        runs: RUNS,
        minPasses: MIN_PASSES,
        expect: [usesTool('whats_overdue'), noProposal('remind_overdue')],
      },
    ],
  }),
);
