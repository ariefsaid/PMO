/**
 * Client-side mirror of the `record_history_config` registry (migration 0260): captured column → kind per
 * entity type. The registry table has no client grant, so the FE keeps its own copy to format values;
 * a column missing here still renders (as text) rather than disappearing.
 */
export type HistoryKind = 'text' | 'number' | 'money' | 'date' | 'timestamp' | 'enum' | 'ref' | 'bool';

const PURCHASE_DOC = { procurement_id: 'ref', reference_number: 'text', currency: 'text', status: 'enum', date: 'date', amount: 'money' } as const;

export const FIELD_KINDS: Record<string, Record<string, HistoryKind>> = {
  project: {
    code: 'text', name: 'text', status: 'enum', client_id: 'ref', project_manager_id: 'ref', end_client_id: 'ref',
    contract_value: 'money', budget: 'money', spent: 'money', tax_amount: 'money', tax_rate: 'number',
    start_date: 'date', end_date: 'date', contract_date: 'date', archived_at: 'timestamp',
    customer_contract_ref: 'text', currency: 'text', tax_template: 'text', service_line: 'text', sector: 'text',
    location: 'text', award_type: 'text', bidding_entity: 'text', tax_treatment: 'enum', subject_to_vat: 'bool',
  },
  budget_version: { project_id: 'ref', version: 'number', name: 'text', status: 'enum', currency: 'text' },
  budget_line_item: {
    budget_version_id: 'ref', category: 'enum', description: 'text', fiscal_year: 'text',
    budgeted_amount: 'money', actual_amount: 'money',
  },
  work_order: {
    project_id: 'ref', wo_number: 'text', client_po_number: 'text', title: 'text', currency: 'text', tax_template: 'text',
    status: 'enum', tax_treatment: 'enum', order_value: 'money', tax_amount: 'money', tax_rate: 'number',
    order_date: 'date', start_date: 'date', end_date: 'date',
  },
  procurement: {
    code: 'text', title: 'text', pr_number: 'text', po_number: 'text', currency: 'text', project_id: 'ref',
    requested_by_id: 'ref', vendor_id: 'ref', status: 'enum', budget_category: 'enum', total_value: 'money',
  },
  purchase_request: { ...PURCHASE_DOC, pr_number: 'text' },
  rfq: { ...PURCHASE_DOC, rfq_number: 'text' },
  purchase_order: { ...PURCHASE_DOC, po_number: 'text' },
  payment: { ...PURCHASE_DOC, invoice_id: 'ref', pay_number: 'text' },
  task: {
    project_id: 'ref', assignee_id: 'ref', milestone_id: 'ref', parent_task_id: 'ref', meeting_id: 'ref', name: 'text',
    status: 'enum', priority: 'enum', start_date: 'date', end_date: 'date', archived_at: 'timestamp',
  },
  company: { name: 'text', short_name: 'text', client_number_segment: 'text', type: 'enum', archived_at: 'timestamp' },
  contact: { company_id: 'ref', full_name: 'text', title: 'text', archived_at: 'timestamp' },
};

export function fieldKind(entityType: string, column: string): HistoryKind {
  return FIELD_KINDS[entityType]?.[column] ?? 'text';
}

/** Where a resolvable ref column's display name comes from. */
export type RefSource = 'profiles' | 'companies' | 'tasks' | 'milestones' | 'procurements';

/**
 * Ref column → the list that names it: people and companies from the org lists, milestone / procurement /
 * parent task from the project's own lists (project History only). A ref column NOT here (project_id,
 * budget_version_id, meeting_id, invoice_id) has no cheap name source, so it renders "<Field> changed".
 */
export const REF_SOURCE: Record<string, RefSource> = {
  project_manager_id: 'profiles',
  requested_by_id: 'profiles',
  assignee_id: 'profiles',
  client_id: 'companies',
  end_client_id: 'companies',
  vendor_id: 'companies',
  company_id: 'companies',
  milestone_id: 'milestones',
  procurement_id: 'procurements',
  parent_task_id: 'tasks',
};

/**
 * Child entity type → the list that names the record. On a project History the project's own lists
 * name tasks / procurements / work orders / budget rows; on a PROCUREMENT History the four purchase
 * documents (#878: filed under their procurement, 0277) are named from the same cached procurement
 * detail the page itself uses. Others read "Unavailable".
 */
export type NameSource =
  | 'tasks'
  | 'procurements'
  | 'workOrders'
  | 'budgetVersions'
  | 'budgetLines'
  | 'purchaseRequests'
  | 'rfqs'
  | 'purchaseOrders'
  | 'payments';
export const RECORD_NAME_SOURCE: Record<string, NameSource> = {
  task: 'tasks',
  procurement: 'procurements',
  work_order: 'workOrders',
  budget_version: 'budgetVersions',
  budget_line_item: 'budgetLines',
  purchase_request: 'purchaseRequests',
  rfq: 'rfqs',
  purchase_order: 'purchaseOrders',
  payment: 'payments',
};

/** `contract_value` → "Contract value": the label fallback so an unlabelled column never renders blank. */
export function humanizeColumn(column: string): string {
  const spaced = column.replace(/_id$/, '').replace(/_/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Kind-filter groups for the project History (Q7): chip label key → entity types it narrows to. */
export const KIND_FILTERS: { key: string; label: string; types: string[] | null }[] = [
  { key: 'all', label: 'All', types: null },
  { key: 'project', label: 'Project', types: ['project'] },
  { key: 'budget', label: 'Budget', types: ['budget_version', 'budget_line_item'] },
  { key: 'workOrders', label: 'Work orders', types: ['work_order'] },
  { key: 'procurement', label: 'Procurement', types: ['procurement', 'purchase_request', 'rfq', 'purchase_order', 'payment'] },
  { key: 'tasks', label: 'Tasks', types: ['task'] },
];
