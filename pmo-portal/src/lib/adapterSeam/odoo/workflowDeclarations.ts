/**
 * What Odoo says about every registered workflow (FR-ECA-050, AC-ODC-095). A workflow left out fails typecheck; the
 * literal version pins fail `contractSuite/parity.test.ts` when a shared suite's behaviour version is bumped.
 *
 * Odoo's census, matching inputs and sends are built (odoo/connectAdapter.ts); a workflow is *supported* only once its
 * shared suite proves it.
 */
import type { TierWorkflows } from '../connect/workflows.ts';

// Odoo route items (map #1481).
const ODOO_REVENUE = 1506;
// DD-ODA-6 (#1507): Odoo Community has no budget object (DD-ODC-5); PMO budgets stay PMO-only on Odoo.
const NO_BUDGET_OBJECT = { status: 'unavailable', version: 1, reason: 'Odoo Community has no budget object; budgets stay in PMO' } as const;
const ODOO_LABOUR = 1510;
const ODOO_SITE_CASH = 1509; // site imprest postings (#1515 §9)
const ODOO_REVENUE_CUTOVER = 1602;
// The register and its maintenance (#1511): the writes ship in F4; the shared suite and the bed proof are F7's.
const ODOO_EQUIPMENT = 1511;

/** Why tax documents cannot be read: Odoo Community v20 has no tax document facts and PMO writes no ERP tax fields (FR-OCI-094, SD-11). */
export const ODOO_TAX_DOCUMENT_UNAVAILABLE_REASON = 'Odoo Community does not expose tax-document facts, and PMO writes no ERP tax-document fields.';

export const ODOO_WORKFLOWS: TierWorkflows = {
  'census': { status: 'supported', version: 1 },
  'party.match': { status: 'supported', version: 2 },
  'party.bring-in': { status: 'supported', version: 1 },
  'party.send': { status: 'supported', version: 1 },
  'project.match': { status: 'supported', version: 1 },
  'project.send': { status: 'supported', version: 1 },
  'item.match': { status: 'supported', version: 1 },
  'item.send': { status: 'supported', version: 1 },
  'account.match': { status: 'supported', version: 1 },
  'employee.match': { status: 'pending', version: 1, issue: ODOO_LABOUR },
  'employee.send': { status: 'pending', version: 1, issue: ODOO_LABOUR },
  'purchase.push': { status: 'supported', version: 1 },
  'bill.push': { status: 'supported', version: 1 },
  'vendor-payment.push': { status: 'supported', version: 1 },
  // AC-OPP-072's shipped page-apply proof covers newest figures and one stored row (`odoo_purchase_page_apply.test.sql`).
  'purchase.link-existing': { status: 'supported', version: 1 },
  'cutover.purchase': { status: 'supported', version: 1 },
  'cutover.timesheet': { status: 'pending', version: 1, issue: ODOO_LABOUR },
  // The production resolver rejects a binding until it is active and company-scoped.
  'cutover.activation': { status: 'supported', version: 1 },
  'invoice.push': { status: 'supported', version: 1 },
  'receipt.read': { status: 'supported', version: 1 },
  'invoice.pair-existing': { status: 'pending', version: 1, issue: ODOO_REVENUE },
  'cutover.revenue': { status: 'pending', version: 1, issue: ODOO_REVENUE_CUTOVER },
  'tax-document.read': { status: 'unavailable', version: 1, reason: ODOO_TAX_DOCUMENT_UNAVAILABLE_REASON },
  'actuals.read': { status: 'supported', version: 1 },
  'budget.push': NO_BUDGET_OBJECT,
  'budget.unowned-occupant': NO_BUDGET_OBJECT,
  'budget.resolve-occupant': NO_BUDGET_OBJECT,
  'timesheet.push': { status: 'pending', version: 1, issue: ODOO_LABOUR },
  'imprest.transfer': { status: 'pending', version: 1, issue: ODOO_SITE_CASH },
  'purchase-order.revise': { status: 'supported', version: 1 },
  'equipment.push': { status: 'pending', version: 1, issue: ODOO_EQUIPMENT },
  'equipment.read': { status: 'pending', version: 1, issue: ODOO_EQUIPMENT },
};
