import type { WorkflowId } from '../connect/workflows.ts';
import { bringInSuite } from './bringIn.suite.ts';
import { budgetSuite } from './budget.suite.ts';
import { cutoverSuite } from './cutover.suite.ts';
import type { Suite } from './harness.ts';
import { imprestTransferSuite } from './imprestTransfer.suite.ts';
import { partySuite } from './party.suite.ts';
import { actualsReadSuite } from './actuals.suite.ts';
import { budgetPushSuite } from './budgetPush.suite.ts';
import { billPushSuite, purchaseLinkExistingSuite, purchasePushSuite, vendorPaymentPushSuite } from './procurement.suite.ts';
import { invoicePushSuite, receiptReadSuite } from './revenue.suite.ts';
import { timesheetPushSuite } from './timesheet.suite.ts';
import { projectSuite } from './project.suite.ts';
import { itemSendSuite, partySendSuite, projectSendSuite } from './send.suite.ts';

/** The shared suite that owns each workflow's behaviour. A workflow with no entry cannot be declared supported. */
export const SUITES: Readonly<Partial<Record<WorkflowId, Suite>>> = {
  'party.match': partySuite,
  'party.bring-in': bringInSuite,
  'party.send': partySendSuite,
  'project.match': projectSuite,
  'project.send': projectSendSuite,
  'item.send': itemSendSuite,
  'budget.unowned-occupant': budgetSuite,
  'cutover.activation': cutoverSuite,
  'purchase.push': purchasePushSuite,
  'bill.push': billPushSuite,
  'vendor-payment.push': vendorPaymentPushSuite,
  'purchase.link-existing': purchaseLinkExistingSuite,
  'invoice.push': invoicePushSuite,
  'receipt.read': receiptReadSuite,
  'actuals.read': actualsReadSuite,
  'budget.push': budgetPushSuite,
  'timesheet.push': timesheetPushSuite,
  'imprest.transfer': imprestTransferSuite,
};
