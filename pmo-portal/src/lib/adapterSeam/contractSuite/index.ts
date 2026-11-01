import type { WorkflowId } from '../connect/workflows.ts';
import { bringInSuite } from './bringIn.suite.ts';
import { budgetSuite } from './budget.suite.ts';
import { censusSuite } from './census.suite.ts';
import { cutoverSuite } from './cutover.suite.ts';
import type { Suite } from './harness.ts';
import { imprestTransferSuite } from './imprestTransfer.suite.ts';
import { matchSuite } from './match.suite.ts';
import { partySuite } from './party.suite.ts';
import { projectSuite } from './project.suite.ts';
import { partySendAllSuite } from './sendAll.suite.ts';
import { itemSendSuite, projectSendSuite } from './send.suite.ts';

/** The shared suite that owns each workflow's behaviour. A workflow with no entry cannot be declared supported. */
export const SUITES: Readonly<Partial<Record<WorkflowId, Suite>>> = {
  'census': censusSuite,
  'item.match': matchSuite('item'),
  'account.match': matchSuite('account'),
  'employee.match': matchSuite('employee'),
  'party.match': partySuite,
  'party.bring-in': bringInSuite,
  'party.send': partySendAllSuite,
  'project.match': projectSuite,
  'project.send': projectSendSuite,
  'item.send': itemSendSuite,
  'budget.unowned-occupant': budgetSuite,
  'cutover.activation': cutoverSuite,
  'imprest.transfer': imprestTransferSuite,
};
