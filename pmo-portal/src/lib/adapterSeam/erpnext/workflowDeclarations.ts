/**
 * What ERPNext says about every registered workflow (FR-ECA-050). A workflow left out fails typecheck. The
 * version pins are literals on purpose: bumping a workflow in `connect/workflows.ts` must make this file fail
 * `contractSuite/parity.test.ts` until ERPNext passes the new suite or re-declares against the new version.
 */
import type { TierWorkflows } from '../connect/workflows.ts';

// ECA slices that will build the missing behaviour (the ERP-connect-anytime map).
const SETUP_CENSUS_AND_PROPOSALS = 1605;
const SEND_TO_EMPTY_ERP = 1606;
const INVOICE_PAIRING = 1602;
// Cut-over proofs that live outside Vitest (the SQL revenue guard, the Deno timesheet backstop): shared suite or permanent exception.
const CUTOVER_PROOFS_OUTSIDE_VITEST = 1676;
// Shipped behaviour whose tests are still tier-local; the follow-up issue moves each into a shared suite.
const SHIPPED_TESTS_NOT_YET_SHARED = 1609;

export const ERPNEXT_WORKFLOWS: TierWorkflows = {
  'census': { status: 'pending', version: 1, issue: SETUP_CENSUS_AND_PROPOSALS },
  'party.match': { status: 'supported', version: 1 },
  'party.bring-in': { status: 'supported', version: 1 },
  'party.send': { status: 'pending', version: 1, issue: SEND_TO_EMPTY_ERP },
  'project.match': { status: 'supported', version: 1 },
  'project.send': { status: 'pending', version: 1, issue: SEND_TO_EMPTY_ERP },
  'item.match': { status: 'pending', version: 1, issue: SETUP_CENSUS_AND_PROPOSALS },
  'item.send': { status: 'pending', version: 1, issue: SEND_TO_EMPTY_ERP },
  'account.match': { status: 'pending', version: 1, issue: SETUP_CENSUS_AND_PROPOSALS },
  'employee.match': { status: 'pending', version: 1, issue: SETUP_CENSUS_AND_PROPOSALS },
  'employee.send': { status: 'pending', version: 1, issue: SEND_TO_EMPTY_ERP },
  'purchase.push': { status: 'pending', version: 1, issue: SHIPPED_TESTS_NOT_YET_SHARED },
  'bill.push': { status: 'pending', version: 1, issue: SHIPPED_TESTS_NOT_YET_SHARED },
  'vendor-payment.push': { status: 'pending', version: 1, issue: SHIPPED_TESTS_NOT_YET_SHARED },
  'purchase.link-existing': { status: 'pending', version: 1, issue: SHIPPED_TESTS_NOT_YET_SHARED },
  'cutover.purchase': { status: 'supported', version: 1 },
  'cutover.timesheet': { status: 'pending', version: 1, issue: CUTOVER_PROOFS_OUTSIDE_VITEST },
  'cutover.activation': { status: 'supported', version: 1 },
  'invoice.push': { status: 'pending', version: 1, issue: SHIPPED_TESTS_NOT_YET_SHARED },
  'receipt.read': { status: 'pending', version: 1, issue: SHIPPED_TESTS_NOT_YET_SHARED },
  'invoice.pair-existing': { status: 'pending', version: 1, issue: INVOICE_PAIRING },
  // SQL guard, tier-agnostic, proven by pgTAP (0275 §7); the shared suite or a documented exception is #1676.
  'cutover.revenue': { status: 'pending', version: 1, issue: CUTOVER_PROOFS_OUTSIDE_VITEST },
  'actuals.read': { status: 'pending', version: 1, issue: SHIPPED_TESTS_NOT_YET_SHARED },
  'budget.push': { status: 'pending', version: 1, issue: SHIPPED_TESTS_NOT_YET_SHARED },
  'budget.unowned-occupant': { status: 'supported', version: 1 },
  'timesheet.push': { status: 'pending', version: 1, issue: SHIPPED_TESTS_NOT_YET_SHARED },
  'imprest.transfer': { status: 'supported', version: 1 },
};
