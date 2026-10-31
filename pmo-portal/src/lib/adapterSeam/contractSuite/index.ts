import type { WorkflowId } from '../connect/workflows.ts';
import { budgetSuite } from './budget.suite.ts';
import { cutoverSuite } from './cutover.suite.ts';
import type { Suite } from './harness.ts';
import { partySuite } from './party.suite.ts';
import { projectSuite } from './project.suite.ts';

/** The shared suite that owns each workflow's behaviour. A workflow with no entry cannot be declared supported. */
export const SUITES: Readonly<Partial<Record<WorkflowId, Suite>>> = {
  'party.match': partySuite,
  'project.match': projectSuite,
  'budget.unowned-occupant': budgetSuite,
  'cutover.activation': cutoverSuite,
};
