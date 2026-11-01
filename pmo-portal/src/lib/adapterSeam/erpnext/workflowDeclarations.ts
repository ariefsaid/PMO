/**
 * What ERPNext says about every registered workflow (FR-ECA-050). A workflow left out fails typecheck. The
 * version pins are literals on purpose: bumping a workflow in `connect/workflows.ts` must make this file fail
 * `contractSuite/parity.test.ts` until ERPNext passes the new suite or re-declares against the new version.
 */
import type { TierWorkflows } from '../connect/workflows.ts';

// ECA slices that will build the missing behaviour (the ERP-connect-anytime map).
const CUTOVER_PROCESS_DOMAINS = 1601;
const INVOICE_PAIRING = 1602;
// Shipped behaviour whose tests are still tier-local; the follow-up issue moves each into a shared suite.
const SHIPPED_TESTS_NOT_YET_SHARED = 1609;

/** Why a person cannot be sent: the declaration's reason, and the sentence the Admin reads (one copy, so another tier never shows this one's). */
export const EMPLOYEE_SEND_UNAVAILABLE_REASON = 'This ERP asks for a birth date and gender for each person, which PMO does not hold.';

export const ERPNEXT_WORKFLOWS: TierWorkflows = {
  'census': { status: 'supported', version: 1 },
  'party.match': { status: 'supported', version: 2 },
  'party.bring-in': { status: 'supported', version: 1 },
  'party.send': { status: 'supported', version: 1 },
  'project.match': { status: 'supported', version: 1 },
  'project.send': { status: 'supported', version: 1 },
  'item.match': { status: 'supported', version: 1 },
  'item.send': { status: 'supported', version: 1 },
  'account.match': { status: 'supported', version: 1 },
  'employee.match': { status: 'supported', version: 1 },
  // PQ-ECA-1, verified on the bed (ECA3-T1): the ERP requires gender, date of birth and date of joining for an employee; PMO holds none of them and never invents them.
  'employee.send': { status: 'unavailable', version: 1, reason: EMPLOYEE_SEND_UNAVAILABLE_REASON },
  'purchase.push': { status: 'pending', version: 1, issue: SHIPPED_TESTS_NOT_YET_SHARED },
  'bill.push': { status: 'pending', version: 1, issue: SHIPPED_TESTS_NOT_YET_SHARED },
  'vendor-payment.push': { status: 'pending', version: 1, issue: SHIPPED_TESTS_NOT_YET_SHARED },
  'purchase.link-existing': { status: 'pending', version: 1, issue: SHIPPED_TESTS_NOT_YET_SHARED },
  'cutover.purchase': { status: 'pending', version: 1, issue: CUTOVER_PROCESS_DOMAINS },
  'cutover.timesheet': { status: 'pending', version: 1, issue: SHIPPED_TESTS_NOT_YET_SHARED },
  'cutover.activation': { status: 'supported', version: 1 },
  'invoice.push': { status: 'pending', version: 1, issue: SHIPPED_TESTS_NOT_YET_SHARED },
  'receipt.read': { status: 'pending', version: 1, issue: SHIPPED_TESTS_NOT_YET_SHARED },
  'invoice.pair-existing': { status: 'pending', version: 1, issue: INVOICE_PAIRING },
  'cutover.revenue': { status: 'pending', version: 1, issue: CUTOVER_PROCESS_DOMAINS },
  'actuals.read': { status: 'pending', version: 1, issue: SHIPPED_TESTS_NOT_YET_SHARED },
  'budget.push': { status: 'pending', version: 1, issue: SHIPPED_TESTS_NOT_YET_SHARED },
  'budget.unowned-occupant': { status: 'supported', version: 1 },
  'timesheet.push': { status: 'pending', version: 1, issue: SHIPPED_TESTS_NOT_YET_SHARED },
  'imprest.transfer': { status: 'supported', version: 1 },
};
