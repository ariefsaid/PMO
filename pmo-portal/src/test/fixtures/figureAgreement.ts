/**
 * Synthetic, immutable records shared by the figure-agreement screen tests.
 * Values are deliberately small and hand-authored so the assertions can pin
 * their expected readings independently of any production figure selector.
 */
type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer U)[]
    ? readonly DeepReadonly<U>[]
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value as DeepReadonly<T>;
}

const records = {
  organisation: {
    id: 'org-figure-agreement',
    name: 'Figure Agreement Organisation',
    currency: 'USD',
    businessDate: '2026-11-12',
  },
  users: {
    executive: { id: 'user-executive', role: 'Executive', org_id: 'org-figure-agreement', locale: 'en', number_locale: 'en-US', timezone: 'UTC' },
    admin: { id: 'user-admin', role: 'Admin', org_id: 'org-figure-agreement', locale: 'en', number_locale: 'en-US', timezone: 'UTC' },
    finance: { id: 'user-finance', role: 'Finance', org_id: 'org-figure-agreement', locale: 'en', number_locale: 'en-US', timezone: 'UTC' },
    projectManager: { id: 'user-project-manager', role: 'Project Manager', full_name: 'Synthetic Project Manager', org_id: 'org-figure-agreement', locale: 'en', number_locale: 'en-US', timezone: 'UTC' },
  },
  projects: {
    primary: {
      id: 'project-figure-primary',
      name: 'S01 Primary Project',
      code: 'S01-001',
      status: 'Ongoing Project',
      client_id: 'company-figure-client',
      project_manager_id: 'user-project-manager',
      contract_value: 1000,
      currency: 'USD',
      budget: 1000,
      tax_treatment: 'exclusive',
      tax_rate: 0,
      tax_amount: 0,
      customer_contract_ref: 'S01-CONTRACT-001',
      contract_date: '2026-01-01',
      decided_at: '2026-01-01T00:00:00.000Z',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      archived_at: null,
      client: { name: 'Synthetic Client' },
      pm: { full_name: 'Synthetic Project Manager' },
    },
    attentionProjects: [
      { id: 'project-attention-1', name: 'S01 Attention 1', status: 'Ongoing Project', currency: 'USD', contract_value: 100, project_manager_id: 'user-project-manager' },
      { id: 'project-attention-2', name: 'S01 Attention 2', status: 'Ongoing Project', currency: 'USD', contract_value: 100, project_manager_id: 'user-project-manager' },
      { id: 'project-attention-3', name: 'S01 Attention 3', status: 'Ongoing Project', currency: 'USD', contract_value: 100, project_manager_id: 'user-project-manager' },
      { id: 'project-attention-4', name: 'S01 Attention 4', status: 'Ongoing Project', currency: 'USD', contract_value: 100, project_manager_id: 'user-project-manager' },
      { id: 'project-attention-5', name: 'S01 Attention 5', status: 'Ongoing Project', currency: 'USD', contract_value: 100, project_manager_id: 'user-project-manager' },
      { id: 'project-attention-6', name: 'S01 Attention 6', status: 'Ongoing Project', currency: 'USD', contract_value: 100, project_manager_id: 'user-project-manager' },
    ],
  },
  budget: {
    activeVersion: { id: 'budget-version-s01', project_id: 'project-figure-primary', name: 'Active budget', version: 1, status: 'Active', currency: 'USD' },
    lines: [{ id: 'budget-line-s01-labour', budget_version_id: 'budget-version-s01', category: 'Labor', description: 'Synthetic labour allowance', budgeted_amount: 1000, currency: 'USD' }],
    paidPurchase: { id: 'purchase-paid-s01', project_id: 'project-figure-primary', status: 'Paid', currency: 'USD', total_value: 500, paid_amount: 500 },
    openPurchaseOrder: { id: 'purchase-open-s01', project_id: 'project-figure-primary', status: 'Ordered', currency: 'USD', total_value: 400, paid_amount: 0 },
    reservedApproval: { id: 'purchase-reserved-s01', project_id: 'project-figure-primary', status: 'Approved', currency: 'USD', total_value: 50, paid_amount: 0 },
    newRequest: { id: 'purchase-request-s01', project_id: 'project-figure-primary', status: 'Requested', currency: 'USD', total_value: 25, paid_amount: 0 },
  },
  billing: {
    contract: { project_id: 'project-figure-primary', contract_value: 1000, currency: 'USD', tax_treatment: 'exclusive', tax_amount: 0 },
    invoices: [
      { id: 'invoice-contract-before', project_id: 'project-figure-primary', number: 'S01-INV-001', status: 'Paid', billing_kind: 'contract', currency: 'USD', amount: 40, tax_amount: 0, erp_outstanding_amount: 0, invoice_date: '2026-10-15' },
      { id: 'invoice-contract-window', project_id: 'project-figure-primary', number: 'S01-INV-002', status: 'Unpaid', billing_kind: 'contract', currency: 'USD', amount: 60, tax_amount: 0, erp_outstanding_amount: 31, invoice_date: '2026-11-05' },
      { id: 'invoice-other-work', project_id: 'project-figure-primary', number: 'S01-INV-003', status: 'Submitted', billing_kind: 'other', currency: 'USD', amount: 50, tax_amount: 0, erp_outstanding_amount: 50, invoice_date: '2026-11-08' },
      { id: 'invoice-advance', project_id: 'project-figure-primary', number: 'S01-INV-004', status: 'Submitted', billing_kind: 'advance', currency: 'USD', amount: 20, tax_amount: 0, erp_outstanding_amount: 20, invoice_date: '2026-11-09' },
    ],
    workRows: [
      { id: 'work-before', project_id: 'project-figure-primary', invoice_id: 'invoice-contract-before', currency: 'USD', net: 40, recovery: 0, month: '2026-10-01' },
      { id: 'work-contract-window', project_id: 'project-figure-primary', invoice_id: 'invoice-contract-window', currency: 'USD', net: 60, recovery: 0, month: '2026-11-01' },
      { id: 'work-other-window', project_id: 'project-figure-primary', invoice_id: 'invoice-other-work', currency: 'USD', net: 50, recovery: 0, month: '2026-11-01' },
      { id: 'work-advance-window', project_id: 'project-figure-primary', invoice_id: 'invoice-advance', currency: 'USD', net: 20, recovery: 0, month: '2026-11-01', is_down_payment: true },
    ],
    receipt: { id: 'receipt-s01', invoice_id: 'invoice-contract-window', currency: 'USD', cash_received: 70, withheld: 10 },
  },
  variations: {
    erpLedger: {
      project_id: 'project-erp-variation',
      ledger_basis: 'erp',
      actuals: { currency: 'USD', total: 500, complete: true, committed_total: null, committed_complete: true },
      openPurchaseOrder: { currency: 'USD', total_value: 400, status: 'Ordered' },
    },
    unknownAndMixedCurrency: {
      unknownActual: { currency: 'USD', total: null, complete: false },
      foreignInvoice: { id: 'invoice-foreign', project_id: 'project-figure-primary', status: 'Unpaid', billing_kind: 'contract', currency: 'EUR', amount: 12, tax_amount: 0, erp_outstanding_amount: null, invoice_date: '2026-11-10' },
      unknownOpenCommitment: { currency: 'EUR', total_value: null, status: 'Ordered' },
    },
    taxAndWithholding: {
      inclusiveInvoice: { id: 'invoice-inclusive-tax', project_id: 'project-figure-primary', status: 'Unpaid', billing_kind: 'contract', currency: 'USD', amount: 111, tax_amount: 11, erp_outstanding_amount: 31, invoice_date: '2026-11-10', tax_treatment: 'inclusive' },
      allocation: { invoice_id: 'invoice-inclusive-tax', cash_received: 70, withheld: 10 },
    },
    noPhaseWeights: [{ id: 'phase-without-weight', project_id: 'project-figure-primary', weight: 0, effective_pct: 60 }],
    sixthAttentionProject: { id: 'project-attention-6', status: 'Ongoing Project', hasOverdueTask: true },
  },
} as const;

export const figureAgreementFixture = deepFreeze(records);
