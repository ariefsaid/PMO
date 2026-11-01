/**
 * What Odoo says about every registered workflow (FR-ECA-050, AC-ODC-095). A workflow left out fails typecheck; the
 * literal version pins fail `contractSuite/parity.test.ts` when a shared suite's behaviour version is bumped.
 *
 * Odoo's census, matching inputs and sends are built (odoo/connectAdapter.ts); a workflow is *supported* only once a
 * shared suite proves it, so the census and proposal kinds wait on the ECA slice that writes their suite.
 */
import type { TierWorkflows } from '../connect/workflows.ts';

// ECA slices that write the shared suite these workflows still lack.
const SETUP_CENSUS_AND_PROPOSALS = 1605;
const PARTY_DEDUPE = 1600;
// Odoo route items (map #1481).
const ODOO_CONNECT = 1504; // O1 slice S7: project links over cost accounts
const ODOO_PROCUREMENT = 1505;
const ODOO_REVENUE = 1506;
const ODOO_ACTUALS_AND_BUDGET = 1507;
const ODOO_LABOUR = 1510;
const ODOO_SITE_CASH = 1509; // site imprest postings (#1515 §9)

export const ODOO_WORKFLOWS: TierWorkflows = {
  'census': { status: 'pending', version: 1, issue: SETUP_CENSUS_AND_PROPOSALS },
  'party.match': { status: 'supported', version: 1 },
  'party.bring-in': { status: 'pending', version: 1, issue: PARTY_DEDUPE },
  'party.send': { status: 'supported', version: 1 },
  'project.match': { status: 'pending', version: 1, issue: ODOO_CONNECT },
  'project.send': { status: 'supported', version: 1 },
  'item.match': { status: 'pending', version: 1, issue: SETUP_CENSUS_AND_PROPOSALS },
  'item.send': { status: 'supported', version: 1 },
  'account.match': { status: 'pending', version: 1, issue: SETUP_CENSUS_AND_PROPOSALS },
  'employee.match': { status: 'pending', version: 1, issue: ODOO_LABOUR },
  'employee.send': { status: 'pending', version: 1, issue: ODOO_LABOUR },
  'purchase.push': { status: 'pending', version: 1, issue: ODOO_PROCUREMENT },
  'bill.push': { status: 'pending', version: 1, issue: ODOO_PROCUREMENT },
  'vendor-payment.push': { status: 'pending', version: 1, issue: ODOO_PROCUREMENT },
  'purchase.link-existing': { status: 'pending', version: 1, issue: ODOO_PROCUREMENT },
  'cutover.purchase': { status: 'pending', version: 1, issue: ODOO_PROCUREMENT },
  'cutover.timesheet': { status: 'pending', version: 1, issue: ODOO_LABOUR },
  // The shared suite drives a purchase push; Odoo has none until O2.
  'cutover.activation': { status: 'pending', version: 1, issue: ODOO_PROCUREMENT },
  'invoice.push': { status: 'pending', version: 1, issue: ODOO_REVENUE },
  'receipt.read': { status: 'pending', version: 1, issue: ODOO_REVENUE },
  'invoice.pair-existing': { status: 'pending', version: 1, issue: ODOO_REVENUE },
  'cutover.revenue': { status: 'pending', version: 1, issue: ODOO_REVENUE },
  'actuals.read': { status: 'pending', version: 1, issue: ODOO_ACTUALS_AND_BUDGET },
  'budget.push': { status: 'pending', version: 1, issue: ODOO_ACTUALS_AND_BUDGET },
  // O4 decides: Odoo Community has no budget object (DD-ODC-5), so this likely becomes unavailable.
  'budget.unowned-occupant': { status: 'pending', version: 1, issue: ODOO_ACTUALS_AND_BUDGET },
  'timesheet.push': { status: 'pending', version: 1, issue: ODOO_LABOUR },
  'imprest.transfer': { status: 'pending', version: 1, issue: ODOO_SITE_CASH },
};
