import type { TFunction } from 'i18next';

/**
 * Literal-key label maps for the history UI. The i18n completeness gate extracts keys statically, so
 * the per-column / per-kind / per-filter labels are spelled out here instead of built from a template.
 * Where the record's own form or rail already names a field, its key is reused so both say the same word.
 */
export function fieldLabels(t: TFunction): Record<string, string> {
  return {
    code: t('history.field.code', 'Code'),
    name: t('history.field.name', 'Name'),
    status: t('history.field.status', 'Status'),
    client_id: t('history.field.client_id', 'Client'),
    project_manager_id: t('history.field.project_manager_id', 'Project manager'),
    end_client_id: t('projectForm.endCustomer.label', 'End customer'),
    contract_value: t('history.field.contract_value', 'Contract value'),
    budget: t('history.field.budget', 'Budget'),
    spent: t('history.field.spent', 'Spent'),
    tax_amount: t('history.field.tax_amount', 'Tax amount'),
    tax_rate: t('history.field.tax_rate', 'Tax rate'),
    start_date: t('history.field.start_date', 'Start date'),
    end_date: t('history.field.end_date', 'End date'),
    contract_date: t('history.field.contract_date', 'Contract date'),
    archived_at: t('history.field.archived_at', 'Archived'),
    customer_contract_ref: t('projectDetail.rail.customerPoRef', 'Customer PO ref'),
    currency: t('history.field.currency', 'Currency'),
    tax_template: t('history.field.tax_template', 'Tax template'),
    service_line: t('projectClassification.serviceLine', 'Service line'),
    sector: t('projectClassification.sector', 'Sector'),
    location: t('projectClassification.location', 'Location'),
    award_type: t('projectClassification.awardType', 'Award type'),
    bidding_entity: t('projectClassification.biddingEntity', 'Bidding entity'),
    tax_treatment: t('history.field.tax_treatment', 'Tax treatment'),
    subject_to_vat: t('history.field.subject_to_vat', 'Subject to VAT'),
    project_id: t('history.field.project_id', 'Project'),
    version: t('history.field.version', 'Version'),
    budget_version_id: t('history.field.budget_version_id', 'Budget version'),
    category: t('history.field.category', 'Category'),
    description: t('history.field.description', 'Description'),
    fiscal_year: t('history.field.fiscal_year', 'Fiscal year'),
    budgeted_amount: t('history.field.budgeted_amount', 'Budgeted amount'),
    actual_amount: t('history.field.actual_amount', 'Actual amount'),
    wo_number: t('history.field.wo_number', 'Work order number'),
    client_po_number: t('history.field.client_po_number', 'Client PO number'),
    title: t('history.field.title', 'Title'),
    order_value: t('history.field.order_value', 'Order value'),
    order_date: t('history.field.order_date', 'Order date'),
    pr_number: t('history.field.pr_number', 'PR number'),
    po_number: t('history.field.po_number', 'PO number'),
    requested_by_id: t('history.field.requested_by_id', 'Requested by'),
    vendor_id: t('history.field.vendor_id', 'Vendor'),
    budget_category: t('history.field.budget_category', 'Budget category'),
    total_value: t('history.field.total_value', 'Total value'),
    procurement_id: t('history.field.procurement_id', 'Procurement'),
    reference_number: t('history.field.reference_number', 'Reference number'),
    date: t('history.field.date', 'Date'),
    amount: t('history.field.amount', 'Amount'),
    rfq_number: t('history.field.rfq_number', 'RFQ number'),
    invoice_id: t('history.field.invoice_id', 'Invoice'),
    pay_number: t('history.field.pay_number', 'Payment number'),
    assignee_id: t('history.field.assignee_id', 'Assignee'),
    milestone_id: t('history.field.milestone_id', 'Milestone'),
    parent_task_id: t('history.field.parent_task_id', 'Parent task'),
    meeting_id: t('history.field.meeting_id', 'Meeting'),
    priority: t('history.field.priority', 'Priority'),
    short_name: t('history.field.short_name', 'Short name'),
    client_number_segment: t('history.field.client_number_segment', 'Client number segment'),
    type: t('history.field.type', 'Type'),
    company_id: t('history.field.company_id', 'Company'),
    full_name: t('history.field.full_name', 'Full name'),
    approval_notes: t('history.field.approval_notes', 'Approval notes'),
    rejection_notes: t('history.field.rejection_notes', 'Rejection notes'),
    email: t('history.field.email', 'Email'),
    phone: t('history.field.phone', 'Phone'),
    notes: t('history.field.notes', 'Notes'),
    efaktur_number: t('history.field.efaktur_number', 'e-Faktur number'),
    efaktur_date: t('history.field.efaktur_date', 'e-Faktur date'),
    received_date: t('history.field.received_date', 'Received date'),
    author_user_id: t('history.field.author_user_id', 'Invoice author'),
    approved_by_id: t('history.field.approved_by_id', 'Approved by'),
    approved_at: t('history.field.approved_at', 'Approved at'),
    pmo_native: t('history.field.pmo_native', 'PMO-created'),
    pmo_number: t('history.field.pmo_number', 'PMO invoice number'),
    native_lines: t('history.field.native_lines', 'Invoice lines'),
    withheld_amount: t('history.field.withheld_amount', 'Tax withheld'),
    withheld_pph_type: t('history.field.withheld_pph_type', 'Withholding tax type'),
    slip_number: t('history.field.slip_number', 'Slip number'),
    slip_date: t('history.field.slip_date', 'Slip date'),
    tax_period: t('history.field.tax_period', 'Tax period'),
    pph_type: t('history.field.pph_type', 'PPh type'),
    tax_base: t('history.field.tax_base', 'Tax base'),
    invoice_count: t('history.field.invoice_count', 'Bill count'),
    voided_at: t('history.field.voided_at', 'Voided at'),
    voided_by: t('history.field.voided_by', 'Voided by'),
    slip_id: t('history.field.slip_id', 'Bukti potong'),
    withheld_at_record: t('history.field.withheld_at_record', 'Withheld at record'),
    pph_type_at_record: t('history.field.pph_type_at_record', 'PPh type at record'),
    type_source: t('history.field.type_source', 'Type source'),
    released_at: t('history.field.released_at', 'Released at'),
  };
}

export function kindLabels(t: TFunction): Record<string, string> {
  return {
    project: t('history.kind.project', 'Project'),
    budget_version: t('history.kind.budget_version', 'Budget version'),
    budget_line_item: t('history.kind.budget_line_item', 'Budget line'),
    work_order: t('history.kind.work_order', 'Work order'),
    procurement: t('history.kind.procurement', 'Procurement'),
    purchase_request: t('history.kind.purchase_request', 'Purchase request'),
    rfq: t('history.kind.rfq', 'RFQ'),
    purchase_order: t('history.kind.purchase_order', 'Purchase order'),
    payment: t('history.kind.payment', 'Payment'),
    task: t('history.kind.task', 'Task'),
    company: t('history.kind.company', 'Company'),
    contact: t('history.kind.contact', 'Contact'),
    sales_invoice: t('history.kind.sales_invoice', 'Sales invoice'),
    procurement_invoice: t('history.kind.procurement_invoice', 'Vendor bill'),
    vendor_withholding_slip: t('history.kind.vendor_withholding_slip', 'Bukti potong'),
    vendor_withholding_slip_bill: t('history.kind.vendor_withholding_slip_bill', 'Bukti potong bill link'),
  };
}

export function filterLabels(t: TFunction): Record<string, string> {
  return {
    all: t('history.filter.all', 'All'),
    project: t('history.filter.project', 'Project'),
    budget: t('projectDetail.tabs.budget', 'Budget'),
    workOrders: t('projectDetail.tabs.workOrders', 'Work orders'),
    procurement: t('projectDetail.tabs.procurement', 'Procurement'),
    tasks: t('projectDetail.tabs.tasks', 'Tasks'),
  };
}

/** A project's `code` is its Client Project Code (the form's word); any other entity's code is just "Code". */
export function projectCodeLabel(t: TFunction): string {
  return t('projectForm.clientCode.label', 'Client Project Code');
}

/** Empty copy for a kind chip with no events (never the "history begins" copy, which is about the record). */
export function filteredEmptyLabels(t: TFunction): Record<string, string> {
  return {
    project: t('history.filteredEmpty.project', 'No project changes'),
    budget: t('history.filteredEmpty.budget', 'No budget changes'),
    workOrders: t('history.filteredEmpty.workOrders', 'No work order changes'),
    procurement: t('history.filteredEmpty.procurement', 'No procurement changes'),
    tasks: t('history.filteredEmpty.tasks', 'No task changes'),
  };
}

/**
 * The merged audit_events lines (#880, AC-CHG-024), by internal action code — the catalogue key spells
 * the code with underscores (i18next reads dots as nesting). This covers the non-delete codes a History-tab root can show that
 * survives `list_record_history`'s audit window (the `.delete` codes and the per-record no-change
 * writes — create/transition echoes the capture already shows — are excluded server-side); any code
 * missing here falls back to the humanised code (see `auditActionLabel`), never the raw dotted form.
 */
export function auditActionLabels(t: TFunction): Record<string, string> {
  return {
    'm365.connection.revoked': t('history.action.m365_connection_revoked', 'Microsoft 365 connection revoked'),
    'integration.activate': t('history.action.integration_activate', 'ERP integration activated'),
    'integration.disconnect': t('history.action.integration_disconnect', 'ERP integration disconnected'),
    'integration.set_company': t('history.action.integration_set_company', 'ERP company mapping set'),
    'integration.site_url_set': t('history.action.integration_site_url_set', 'ERP site URL set'),
    'integration.trap_recovery': t('history.action.integration_trap_recovery', 'ERP sync recovered'),
    'integration.connect.cleanup': t('history.action.integration_connect_cleanup', 'ERP connection cleaned up'),
    'integration.connect.finalize': t('history.action.integration_connect_finalize', 'ERP connection finalized'),
    'project_document.create': t('history.action.project_document_create', 'Project document created'),
    'project_document.update': t('history.action.project_document_update', 'Project document updated'),
    'project_document.transition': t('history.action.project_document_transition', 'Project document status changed'),
    'progress_claim.create': t('history.action.progress_claim_create', 'Progress claim created'),
    'progress_claim.withdraw': t('history.action.progress_claim_withdraw', 'Progress claim withdrawn'),
    'progress_claim.evidence.attach': t('history.action.progress_claim_evidence_attach', 'Progress claim evidence attached'),
    'procurement_invoice.create': t('history.action.procurement_invoice_create', 'Vendor invoice created'),
    'procurement.approval_route': t('history.action.procurement_approval_route', 'Approval route recorded'),
    'incoming_payment.create': t('history.action.incoming_payment_create', 'Incoming payment recorded'),
    'incoming_payment.cancel': t('history.action.incoming_payment_cancel', 'Incoming payment cancelled'),
    'expense_advance.return': t('history.action.expense_advance_return', 'Expense advance returned'),
    'expense_claim.transition': t('history.action.expense_claim_transition', 'Expense claim status changed'),
    'expense_claim.approval_route': t('history.action.expense_claim_approval_route', 'Approval route recorded'),
    'timesheet.create': t('history.action.timesheet_create', 'Timesheet created'),
    'spend_approver.add': t('history.action.spend_approver_add', 'Spend approver added'),
    'spend_approver.remove': t('history.action.spend_approver_remove', 'Spend approver removed'),
    'sales_invoice.transition': t('history.action.sales_invoice_transition', 'Customer invoice status changed'),
    'credits.grant': t('history.action.credits_grant', 'Credits granted'),
    'company.tax_defaults.change': t('history.action.company_tax_defaults_change', 'Company tax defaults changed'),
    'org.withholding_account.change': t('history.action.org_withholding_account_change', 'Withholding accounts changed'),
    'org.vendor_tax_accounts.change': t('history.action.org_vendor_tax_accounts_change', 'Vendor tax accounts changed'),
    'org.tax_default.change': t('history.action.org_tax_default_change', 'Tax defaults changed'),
    'org.down_payment_item.change': t('history.action.org_down_payment_item_change', 'Down-payment items changed'),
    'meeting.grant.create': t('history.action.meeting_grant_create', 'Meeting access granted'),
    'meeting.grant.revoke': t('history.action.meeting_grant_revoke', 'Meeting access revoked'),
  };
}

/**
 * The text of one audit line: the translated label for a known code; otherwise the code read as
 * words (`brand_new.code_here` → "Brand new code here") — readable, never the raw dotted code.
 */
export function auditActionLabel(t: TFunction, action: string | null): string {
  if (!action) return t('history.auditRecorded', 'Recorded event');
  const known = auditActionLabels(t)[action];
  if (known) return known;
  const words = action.replace(/[._]+/g, ' ').trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : action;
}
