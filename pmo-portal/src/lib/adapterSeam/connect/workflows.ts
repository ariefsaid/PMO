/**
 * The ERP sync-workflow registry (FR-ECA-050/052, spec §6.3/§6.4). One row per workflow PMO runs against an ERP,
 * with a behaviour version. Every ERP tier declares every row (`TierWorkflows` is a total record, so adding a row
 * here breaks typecheck for each tier until it declares it). PMO terms only; relative imports so the seam stays
 * Deno-importable.
 *
 * ⚑ Changing what the shared suite for a workflow asserts means bumping its `version` here: every tier that still
 * pins the old number then fails `contractSuite/parity.test.ts` until it passes the new suite or re-declares the
 * workflow unavailable/pending against the new version.
 */

export const WORKFLOWS = {
  // Setup and masters (ECA-1..3)
  'census': { version: 1, summary: 'read-only count of each master kind and money domain on both sides' },
  'party.match': { version: 1, summary: 'pair an ERP client/vendor with an existing PMO company, never auto-merging a doubtful pair' },
  'party.bring-in': { version: 1, summary: 'create a PMO company for an ERP party with no PMO match' },
  'party.send': { version: 1, summary: 'create an ERP client/vendor for a PMO company that has none' },
  'project.match': { version: 1, summary: 'link a PMO project to an ERP project, with no link when the ERP name is not unique' },
  'project.send': { version: 1, summary: 'create an ERP project for a PMO project that has none' },
  'item.match': { version: 1, summary: 'pair PMO purchase lines with ERP items' },
  'item.send': { version: 1, summary: 'create ERP items for PMO purchase lines' },
  'account.match': { version: 1, summary: 'propose the ERP account for each PMO budget category' },
  'employee.match': { version: 1, summary: 'pair PMO people with ERP employees' },
  'employee.send': { version: 1, summary: 'create ERP employees for PMO people' },
  // Process domains
  'purchase.push': { version: 1, summary: 'send a purchase order and its receipt to the ERP' },
  'bill.push': { version: 1, summary: 'send a vendor bill to the ERP' },
  'vendor-payment.push': { version: 1, summary: 'send a vendor payment to the ERP' },
  'purchase.link-existing': { version: 1, summary: 'link ERP purchase documents to PMO purchases without double counting' },
  'cutover.purchase': { version: 1, summary: 'a purchase started before the connection pushes no later step' },
  'cutover.timesheet': { version: 1, summary: 'hours approved before the connection are never sent' },
  'cutover.activation': { version: 1, summary: 'nothing reaches the ERP until the connection is activated' },
  'invoice.push': { version: 1, summary: 'send a sales invoice to the ERP' },
  'receipt.read': { version: 1, summary: 'read customer receipts from the ERP' },
  'invoice.pair-existing': { version: 1, summary: 'pair PMO invoices with the same invoices already in the ERP' },
  'cutover.revenue': { version: 1, summary: 'employing revenue is refused while PMO drafts would be stranded' },
  'actuals.read': { version: 1, summary: 'read ledger actuals from the ERP' },
  'budget.push': { version: 1, summary: 'send an active budget version to the ERP' },
  'budget.unowned-occupant': { version: 1, summary: 'refuse to amend an ERP budget PMO did not create, writing nothing' },
  'timesheet.push': { version: 1, summary: 'send an approved timesheet to the ERP' },
  'imprest.transfer': { version: 1, summary: 'move cash between two of the company\'s own accounts once, by key' },
  'purchase-order.revise': { version: 1, summary: 'send the effective lines of one PO revision to the ERP once, never cancelling a billed order' },
} as const satisfies Record<string, { version: number; summary: string }>;

export type WorkflowId = keyof typeof WORKFLOWS;

/** What a tier says about one workflow. `version` pins the behaviour version the claim was made against. */
export type Declaration =
  | { status: 'supported'; version: number }
  | { status: 'unavailable'; version: number; reason: string }
  | { status: 'pending'; version: number; issue: number };

/** A missing key is a typecheck error (FR-ECA-050): a tier must say something about every workflow. */
export type TierWorkflows = Record<WorkflowId, Declaration>;
