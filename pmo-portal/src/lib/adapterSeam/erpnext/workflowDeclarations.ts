/**
 * What ERPNext says about every registered workflow (FR-ECA-050). A workflow left out fails typecheck. The
 * version pins are literals on purpose: bumping a workflow in `connect/workflows.ts` must make this file fail
 * `contractSuite/parity.test.ts` until ERPNext passes the new suite or re-declares against the new version.
 */
import type { TierWorkflows } from '../connect/workflows.ts';

// ECA slices that will build the missing behaviour (the ERP-connect-anytime map).
const SEND_TO_EMPTY_ERP = 1606;
const CUTOVER_PROCESS_DOMAINS = 1601;
const INVOICE_PAIRING = 1602;
// Documented exception (#1601): `cutover.timesheet` is shipped, but its only proof is Deno-side (the sweep's
// timesheet backstop in `supabase/functions/erpnext-sweep`). The shared suites run in Vitest through a
// tier harness over a mocked transport, and that code is not importable there (it boots `Deno.serve`). It stays
// pending against the open cut-over issue that owns a shared Deno-side suite; the Deno test keeps running in the meantime.
const DENO_SIDE_PROOF_ONLY = 1601;

export const ERPNEXT_WORKFLOWS: TierWorkflows = {
  'census': { status: 'supported', version: 1 },
  'party.match': { status: 'supported', version: 2 },
  'party.bring-in': { status: 'supported', version: 1 },
  'party.send': { status: 'pending', version: 1, issue: SEND_TO_EMPTY_ERP },
  'project.match': { status: 'supported', version: 1 },
  'project.send': { status: 'pending', version: 1, issue: SEND_TO_EMPTY_ERP },
  'item.match': { status: 'supported', version: 1 },
  'item.send': { status: 'pending', version: 1, issue: SEND_TO_EMPTY_ERP },
  'account.match': { status: 'supported', version: 1 },
  'employee.match': { status: 'supported', version: 1 },
  'employee.send': { status: 'pending', version: 1, issue: SEND_TO_EMPTY_ERP },
  'purchase.push': { status: 'supported', version: 1 },
  'bill.push': { status: 'supported', version: 1 },
  'vendor-payment.push': { status: 'supported', version: 1 },
  'purchase.link-existing': { status: 'supported', version: 1 },
  'cutover.purchase': { status: 'pending', version: 1, issue: CUTOVER_PROCESS_DOMAINS },
  'cutover.timesheet': { status: 'pending', version: 1, issue: DENO_SIDE_PROOF_ONLY },
  'cutover.activation': { status: 'supported', version: 1 },
  'invoice.push': { status: 'supported', version: 1 },
  'receipt.read': { status: 'supported', version: 1 },
  'invoice.pair-existing': { status: 'pending', version: 1, issue: INVOICE_PAIRING },
  'cutover.revenue': { status: 'pending', version: 1, issue: CUTOVER_PROCESS_DOMAINS },
  'actuals.read': { status: 'supported', version: 1 },
  'budget.push': { status: 'supported', version: 1 },
  'budget.unowned-occupant': { status: 'supported', version: 1 },
  'timesheet.push': { status: 'supported', version: 1 },
  'imprest.transfer': { status: 'supported', version: 1 },
  'purchase-order.revise': { status: 'pending', version: 1, issue: 1505 }, // #1505 carries the revise transport
};
