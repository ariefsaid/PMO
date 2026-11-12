import { figureAgreementFixture as fixture } from './fixtures/figureAgreement';

let singleCurrencyContractCase = false;

export function setFigureAgreementSingleCurrencyContractCase(enabled: boolean): void {
  singleCurrencyContractCase = enabled;
}

/** Repository-boundary wire responses for the synthetic records; figure code remains shipped code. */
export function createFigureAgreementRepositoryModule<T extends { repositories: Record<string, unknown> }>(actual: T): T {
  const base = actual.repositories as Record<string, Record<string, unknown>>;
  const primary = fixture.projects.primary;
  const paidSpend = `${fixture.budget.paidPurchase.total_value}.00`;
  const openCommitment = `${fixture.budget.openPurchaseOrder.total_value}.00`;
  const activeBudget = `${fixture.budget.lines[0].budgeted_amount}.00`;
  const projectRow = {
    ...primary,
    short_name: 'S01 Primary',
    pmo_project_number: 'S01-001',
    service_line: null,
    sector: null,
    location: null,
    award_type: null,
    bidding_entity: null,
    end_client_id: null,
    end_client: null,
    last_update: '2026-11-12T00:00:00.000Z',
    project_manager_id: fixture.users.projectManager.id,
    pm: { id: fixture.users.projectManager.id, full_name: 'Synthetic Project Manager' },
  };
  const budgetVersion = {
    ...fixture.budget.activeVersion,
    total: fixture.budget.lines[0].budgeted_amount,
    activated_at: '2026-01-01T00:00:00.000Z',
    activated_by: fixture.users.executive.id,
    line_items: [{ ...fixture.budget.lines[0], budgeted_amount: activeBudget, committed_amount: openCommitment, actual_amount: paidSpend }],
  };
  const finances = {
    project_id: primary.id,
    contract_invoiced: '100.00',
    remaining_to_invoice: '900.00',
    invoices: [{
      currency: 'USD', invoice_count: 4, invoiced: '170.00', settled: '139.00', outstanding: '31.00',
      missing_amount: 0, missing_outstanding: 0, tax_basis: 'exclusive', work_revenue: '150.00', missing_work: 0,
    }],
    budget: { id: fixture.budget.activeVersion.id, name: 'Active budget', version: 1, status: 'Active', currency: 'USD', amount: '1000.00' },
    actuals: {
      currency: 'USD', as_of: '2026-11-12T00:00:00.000Z', total: '500.00', tagged_total: null, attributed_total: null,
      excludes_restricted_rows: false, categories: [{ category: 'Labor', mapped: true, amount: '500.00' }],
    },
    cash_received: { state: 'known', buckets: [{ currency: 'USD', amount: '70.00' }], receipt_count: 1 },
  };
  const contractFinanceReading = () => singleCurrencyContractCase
    ? finances
    : { ...finances, contract_invoiced: null, remaining_to_invoice: null };
  const billing = { contractNet: 1000, contractLines: [], workOrders: [], claims: [], figuresComplete: true };
  const committedSpend = { amount: fixture.budget.openPurchaseOrder.total_value, otherCurrencies: [] };
  const moneyRead = {
    ledgerBasis: 'pmo',
    actuals: {
      currency: 'USD', total: paidSpend, asOf: '2026-11-12T00:00:00.000Z', excludesRestrictedRows: false,
      complete: true, committedTotal: openCommitment, committedComplete: true,
      categories: [{ category: 'Labor', mapped: true, amount: paidSpend }],
    },
    activeBudgetAmount: activeBudget, activeBudgetCurrency: 'USD', hasActiveBudget: true,
  };
  const invoices = [...fixture.billing.invoices, fixture.variations.unknownAndMixedCurrency.foreignInvoice].map((invoice) => ({
    ...invoice,
    project_id: primary.id,
    client_id: 'company-figure-client',
    created_at: `${invoice.invoice_date}T00:00:00.000Z`,
    due_date: '2026-12-05',
    tax_treatment: 'exclusive',
    tax_rate: 0,
    tax_base_numerator: null,
    tax_base_denominator: null,
    erp_invoice_id: null,
    notes: null,
  }));
  const projects = [projectRow];
  const mapFor = <V,>(ids: string[], make: (id: string) => V) => Object.fromEntries(ids.map((id) => [id, make(id)]));

  const override = (name: string, methods: Record<string, unknown>) => ({ ...(base[name] ?? {}), ...methods });
  const repositories = {
    ...base,
    orgSettings: override('orgSettings', { getLocaleDefaults: async () => ({ defaultLocale: 'en', defaultNumberLocale: 'en-US', defaultTimezone: 'UTC' }) }),
    fxRates: override('fxRates', { context: async () => ({ currency: 'USD', timezone: 'UTC' }) }),
    project: override('project', {
      list: async () => projects,
      getWithRefs: async () => projectRow,
      listIdentity: async () => projects.map(({ id, name }) => ({ id, name })),
      listPickerOptions: async () => projects.map(({ id, name, code, status, project_manager_id }) => ({ id, name, code, status, project_manager_id })),
      listNumbers: async (ids: string[]) => ids.map((id) => ({ id, pmo_project_number: 'S01-001' })),
    }),
    projectMoney: override('projectMoney', { collection: async (ids: string[]) => mapFor(ids, () => moneyRead) }),
    projectOverview: override('projectOverview', {
      read: async () => ({ finances: contractFinanceReading(), billing, boqItems: [], budgetVersions: [budgetVersion], committedSpend, externalDomainOwnership: [], readsErpLedger: false, milestones: [], commentCount: 0, fxContext: { currency: 'USD', timezone: 'UTC' } }),
    }),
    milestone: override('milestone', {
      list: async () => [],
      deliveryForProjects: async (ids: string[]) => mapFor(ids, () => 60),
      deliverySummaryForProjects: async (ids: string[]) => mapFor(ids, () => ({ deliveryPct: 60, committedSpend: 400, budget: 1000 })),
      milestoneDatesForProjects: async () => [],
    }),
    budget: override('budget', {
      deriveProjectBudget: async () => 1000,
      listVersions: async () => [budgetVersion],
      getDistribution: async () => null,
      listArchiveLiveTargets: async () => [],
      listLegacyArchiveLiveTargets: async () => [],
    }),
    procurement: override('procurement', {
      list: async () => [],
      listByProject: async () => [],
      getProjectCommittedSpend: async () => committedSpend,
      getProjectReservedSpend: async () => ({ amount: '50.00', projectCurrency: 'USD', budgetCurrency: 'USD', otherCurrencies: [] }),
    }),
    revenue: override('revenue', {
      getProjectFinances: async () => contractFinanceReading(),
      getOrgReadsErpLedger: async () => false,
      listInvoices: async () => singleCurrencyContractCase ? invoices.filter((invoice) => invoice.currency === 'USD') : invoices,
      getRevenueByProject: async () => [{ project_id: primary.id, currency: 'USD', invoice_count: 5 }],
      listMonthlyInvoiceFacts: async () => [],
      listPaidPaymentFacts: async () => [],
      listOverdueInvoiceFacts: async () => [],
      hasAnySalesInvoice: async () => true,
      listRevenueByProject: async () => [],
    }),
    progressBilling: override('progressBilling', {
      listBoq: async () => [],
      listClaims: async () => [],
      summary: async () => billing,
    }),
    workOrder: override('workOrder', { list: async () => [], drawdown: async () => null, billing: async () => [], acceptanceAge: async () => [], unbilled: async () => ({ totals: [], incompleteCount: 0 }) }),
    company: override('company', { list: async () => [], listClients: async () => [] }),
    profile: override('profile', { listProjectManagers: async () => [fixture.users.projectManager] }),
    orgFeature: override('orgFeature', { listOwn: async () => [] }),
    task: override('task', { list: async () => [], listMy: async () => [], listForProjects: async () => [], listByAssignee: async () => [] }),
    reports: override('reports', {
      managementPack: async () => ({
        from: '2026-11-01', to: '2026-11-01', timezone: 'UTC', org_currency: 'USD', undated_invoice_count: 0,
        projects: [{ id: primary.id, name: primary.name, pmo_project_number: 'S01-001', code: primary.code, status: primary.status, currency: 'USD', contract_net: 1000, start_date: '2026-01-01', end_date: '2026-12-31', project_manager_id: fixture.users.projectManager.id, client_name: 'Synthetic Client' }],
        invoiced: [
          { project_id: primary.id, currency: 'USD', month: '2026-11-01', net: 60, invoice_count: 1 },
          { project_id: primary.id, currency: 'USD', month: '2026-11-01', net: 50, invoice_count: 1 },
        ],
        invoiced_before: [{ project_id: primary.id, currency: 'USD', net: 40, invoice_count: 1 }],
        progress: [], earned: [],
      }),
      figures: async () => ({ pack: { asAt: '2026-11-01', unbilled: [{ currency: 'USD', cents: 0 }], contractRows: 1, invoicedBasisRows: 1 }, statement: { unpublished: true, periodStart: null, netProfit: null, currency: null } }),
      recordProgress: async () => undefined,
    }),
  };

  return { ...actual, repositories };
}
