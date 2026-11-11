/**
 * ERP `Budget` `toBody`/`fromDoc` — P3c (ADR-0055 §6 + ADR-0059 Posture B). Field map FROZEN by
 * docs/spikes/2026-07-16-erpnext-budget-fields.md (a live stock v15 bench, not a hypothesis).
 *
 * ⚑ Direction: PMO → ERP. PMO is the SoT for the budget figure (OD-BUDGET-1); ERP receives a COPY for
 * the GL and — the actual point of the feature — its NATIVE OVERSPEND CONTROLS. So the `action_if_*`
 * fields are not garnish; a `Budget` pushed without them is either inert or actively harmful.
 *
 * ⚑ FR-BUD-160: this body carries ONLY the Active version's budgeted amount per MAPPED category. It never
 * carries `pmo_etc`, an EAC, a variance or a utilization — the projection is PMO's forecast, and pushing
 * it would put a PMO estimate into the client's GL controls.
 *
 * ⚑ Everything here fails CLOSED. A missing company/fiscal year/ERP project, an unmapped category, an
 * unrecognised overspend action, or an empty `accounts` array all THROW before the caller can issue a
 * single ERP request. Two of those are not merely tidiness:
 *   - an empty/absent `accounts` is an UNGUARDED ERP 500 (`ba.account in ()`, spike §10(a)) — a raw SQL
 *     error, not a classifiable 4xx, and never safe to retry;
 *   - a wrong/defaulted account or a silently dropped line makes ERP enforce the client's spending
 *     controls against the wrong figure, which is worse than not pushing at all.
 */
import { AdapterError } from '../../contract.ts';
import type { PmoRecord } from '../../contract.ts';
import type { ErpCtx } from '../doctypeRegistry.ts';
import { resolveBudgetAccounts, type BudgetLineItem, type CategoryAccountMapRow } from '../../../budget/categoryAccountMap.ts';
import { resolveV16BudgetAccounts } from '../budgetAccountPlan.ts';
import { allocate, yearsInSpan, type FiscalYearSpan, type YearAmount } from '../../../budget/budgetDistribution.ts';
import { parseExactCents } from '../../../exactDecimal.ts';

/** The `Select` domain of every `action_if_*` field (spike §1, verbatim from the doctype meta). */
const OVERSPEND_ACTIONS = ['Stop', 'Warn', 'Ignore'] as const;
type OverspendAction = (typeof OVERSPEND_ACTIONS)[number];

/**
 * ⚑ ALL SIX action fields, always — do not "simplify" this to the annual one.
 *
 * The doctype defaults the three ANNUAL controls (actual expenses, material request, purchase order) to
 * **Stop** (spike §1), and `applicable_on_booking_actual_expenses` is observed to come back **1** on a
 * created doc regardless of the meta's stated default (spike §2). So a body that omits these inherits
 * ERP's Stop and the FIRST push starts BLOCKING the client's procurement org-wide as a side effect of an
 * integration (FR-BUD-131). Stating all six makes the org's configured action — default `'Warn'` — the
 * only behaviour that can result.
 */
const ACTION_FIELDS = [
  'action_if_annual_budget_exceeded',
  'action_if_accumulated_monthly_budget_exceeded',
  'action_if_annual_budget_exceeded_on_mr',
  'action_if_accumulated_monthly_budget_exceeded_on_mr',
  'action_if_annual_budget_exceeded_on_po',
  'action_if_accumulated_monthly_budget_exceeded_on_po',
] as const;

/** The org's optional `applicable_on_*` toggles (§4.4 binding config), PMO-side key → ERP field. */
const APPLICABLE_ON_FIELDS: Readonly<Record<string, string>> = {
  material_request: 'applicable_on_material_request',
  purchase_order: 'applicable_on_purchase_order',
  booking_actual_expenses: 'applicable_on_booking_actual_expenses',
};

function requireString(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AdapterError('commit-rejected', `budget push: ${what} is unresolved`);
  }
  return value;
}

function resolveOverspendAction(config: Record<string, unknown>): OverspendAction {
  // FR-BUD-131: 'Warn' by default, NEVER 'Stop'. Flipping to 'Stop' is an Admin, audited opt-in because
  // it makes ERP REFUSE a purchase order that exceeds the budget.
  const configured = config.budget_overspend_action;
  if (configured === undefined || configured === null) return 'Warn';
  if (!OVERSPEND_ACTIONS.includes(configured as OverspendAction)) {
    // Fail closed rather than falling back: a typo'd config must not silently produce a control the org
    // did not choose (in either direction).
    throw new AdapterError(
      'commit-rejected',
      `budget push: unrecognised overspend action ${JSON.stringify(configured)} (expected Stop|Warn|Ignore)`,
    );
  }
  return configured as OverspendAction;
}

function resolveApplicableOn(config: Record<string, unknown>): Record<string, 0 | 1> {
  const configured = config.budget_applicable_on as Record<string, unknown> | undefined;
  if (!configured) return {};
  const out: Record<string, 0 | 1> = {};
  for (const [pmoKey, erpField] of Object.entries(APPLICABLE_ON_FIELDS)) {
    if (pmoKey in configured) out[erpField] = configured[pmoKey] ? 1 : 0;
  }
  return out;
}

/**
 * BFY (FR-BFY-030) PIN: this builder produces EXACTLY ONE ERP `Budget` body per call, from the
 * record's `line_items` + `fiscal_year`. The per-year FAN-OUT (one Budget per phased fiscal year) is
 * the dispatch boundary's job (T13, `adapter-dispatch/index.ts`), which calls this once per year with
 * that year's slice. This builder never splits a body; an empty `accounts[]` throws (spike §10(a)) so
 * the fan-out can never mint an empty Budget. Pinned by the `BFY T5` cases in this file.
 */
export function budgetToBody(rec: PmoRecord, ctx: ErpCtx): unknown {
  const budgetMode = (rec as Record<string, unknown>).budget_mode;
  if (budgetMode === 'whole_project' && ctx.versionMajor !== 16) {
    throw new AdapterError('commit-rejected', 'budget push: whole-project budgets are unsupported on ERPNext v15');
  }
  if (ctx.versionMajor === 16) {
    const intent = (rec as Record<string, unknown>).budget_intent;
    if (intent === 'remove') throw new AdapterError('commit-rejected', 'budget push: remove intent has no ERP body');
    if (budgetMode === 'whole_project') return v16RangeBody(rec, ctx);
    if (budgetMode !== undefined && budgetMode !== 'per_year') {
      throw new AdapterError('commit-rejected', `budget push: unsupported budget mode ${String(budgetMode)}`);
    }
    const account = (rec as Record<string, unknown>).erp_account;
    const body = v16Bodies(rec, ctx).find((candidate) => candidate.account === account);
    if (!body) throw new AdapterError('commit-rejected', `budget push: selected account ${String(account)} is unresolved`);
    return body;
  }
  // FR-BUD-013 fail-closed refs: an unresolvable ERP project is never a null/omitted dimension and never
  // a cost_center fallback — an unattributed budget silently mis-scopes the overspend controls.
  const project = requireString(ctx.refs.project, 'the ERP project reference');
  const company = requireString(ctx.config.company, 'the binding company');
  const fiscalYear = requireString((rec as Record<string, unknown>).fiscal_year, 'the fiscal year');

  const map = (ctx.config.category_account_map as CategoryAccountMapRow[] | undefined) ?? [];
  const lineItems = ((rec as Record<string, unknown>).line_items as BudgetLineItem[] | undefined) ?? [];
  // Throws BudgetCategoryUnmappedError (FR-BUD-113) naming every unmapped category — before any ERP call.
  const accounts = resolveBudgetAccounts(lineItems, map);
  if (accounts.length === 0) {
    throw new AdapterError(
      'commit-rejected',
      'budget push: the active version has no budgeted amount to push (an empty ERP accounts[] crashes the Budget doctype)',
    );
  }

  const action = resolveOverspendAction(ctx.config);
  const body: Record<string, unknown> = {
    company,
    fiscal_year: fiscalYear,
    budget_against: 'Project', // FR-BUD-115 — the project dimension; `cost_center` is never sent
    project,
    accounts,
    ...resolveApplicableOn(ctx.config),
  };
  for (const field of ACTION_FIELDS) body[field] = action;
  return body;
}

type BudgetRangeYearAmount = YearAmount;

function v16RangeBody(rec: PmoRecord, ctx: ErpCtx): Record<string, unknown> {
  const record = rec as Record<string, unknown>;
  const project = requireString(ctx.refs.project, 'the ERP project reference');
  const company = requireString(ctx.config.company, 'the binding company');
  const fromFiscalYear = requireString(record.fiscal_year, 'the start fiscal year');
  const toFiscalYear = requireString(record.to_fiscal_year, 'the end fiscal year');
  const start = requireString(record.project_start_date, 'the project start date');
  const endValue = record.project_end_date;
  if (endValue !== null && typeof endValue !== 'string') {
    throw new AdapterError('commit-rejected', 'budget push: the project end date is invalid');
  }
  if (!Array.isArray(record.fiscal_years) || !Array.isArray(record.year_amounts)) {
    throw new AdapterError('commit-rejected', 'budget push: the approved range distribution is unresolved');
  }

  let years: FiscalYearSpan[];
  try {
    years = yearsInSpan(start, endValue as string | null, record.fiscal_years as FiscalYearSpan[]);
  } catch {
    throw new AdapterError('commit-rejected', 'budget push: the approved fiscal-year span is invalid or unresolved');
  }
  const yearAmounts = record.year_amounts as BudgetRangeYearAmount[];
  if (years.length === 0 || yearAmounts.length !== years.length
    || years[0]?.name !== fromFiscalYear || years.at(-1)?.name !== toFiscalYear
    || yearAmounts.some((row, index) => !row || row.year !== years[index]?.name)) {
    throw new AdapterError('commit-rejected', 'budget push: the approved yearly amounts do not match the fiscal-year span');
  }

  const lineItems = record.line_items;
  if (!Array.isArray(lineItems) || lineItems.length === 0
    || lineItems.some((line) => (line as BudgetLineItem).fiscal_year)) {
    throw new AdapterError('commit-rejected', 'budget push: whole-project lines must be unphased');
  }
  const categoryMap = (ctx.config.category_account_map as CategoryAccountMapRow[] | undefined) ?? [];
  const accounts = resolveV16BudgetAccounts(lineItems as BudgetLineItem[], categoryMap);
  const accountName = requireString(record.erp_account, 'the ERP account');
  const account = accounts.find((row) => row.account === accountName);
  if (!account) {
    throw new AdapterError('commit-rejected', `budget push: selected account ${accountName} is unresolved`);
  }

  const rowCents = yearAmounts.map((row) => {
    if (!row || typeof row.amount !== 'string') {
      throw new AdapterError('commit-rejected', 'budget push: an approved yearly amount is malformed');
    }
    const cents = parseExactCents(row.amount);
    if (cents === null || cents < 0n) {
      throw new AdapterError('commit-rejected', `budget push: invalid amount for fiscal year ${row.year}`);
    }
    return cents;
  });
  const totalCents = rowCents.reduce((sum, cents) => sum + cents, 0n);
  const sourceCents = parseExactCents(account.budget_amount);
  if (totalCents <= 0n || sourceCents === null || totalCents !== sourceCents || !Number.isSafeInteger(Number(totalCents))) {
    throw new AdapterError('commit-rejected', 'budget push: yearly amounts do not exactly reconcile to the approved account total');
  }

  const percentageUnits = allocate(1_000_000n, rowCents);
  if (percentageUnits.reduce((sum, units) => sum + units, 0n) !== 1_000_000n
    || percentageUnits.some((units, index) => rowCents[index] > 0n && units === 0n)) {
    throw new AdapterError('commit-rejected', 'budget push: an approved amount cannot be represented by a finite yearly percent');
  }
  const distribution = years.map((year, index) => ({
    start_date: year.start,
    end_date: year.end,
    amount: Number(rowCents[index]) / 100,
    percent: Number(percentageUnits[index]) / 10_000,
  }));
  if (distribution.some((row) => !Number.isFinite(row.amount) || !Number.isFinite(row.percent))) {
    throw new AdapterError('commit-rejected', 'budget push: the approved yearly distribution is not representable');
  }

  const action = resolveOverspendAction(ctx.config);
  const body: Record<string, unknown> = {
    company,
    budget_against: 'Project',
    project,
    account: accountName,
    budget_amount: Number(totalCents) / 100,
    from_fiscal_year: fromFiscalYear,
    to_fiscal_year: toFiscalYear,
    distribution_frequency: 'Yearly',
    distribute_equally: 0,
    budget_distribution: distribution,
    ...resolveApplicableOn(ctx.config),
  };
  for (const field of ACTION_FIELDS) body[field] = action;
  return body;
}

function v16Bodies(rec: PmoRecord, ctx: ErpCtx): Record<string, unknown>[] {
  const project = requireString(ctx.refs.project, 'the ERP project reference');
  const company = requireString(ctx.config.company, 'the binding company');
  const fiscalYear = requireString((rec as Record<string, unknown>).fiscal_year, 'the fiscal year');
  const map = (ctx.config.category_account_map as CategoryAccountMapRow[] | undefined) ?? [];
  const lineItems = ((rec as Record<string, unknown>).line_items as BudgetLineItem[] | undefined) ?? [];
  const accounts = resolveV16BudgetAccounts(lineItems, map);
  if (accounts.length === 0) {
    throw new AdapterError('commit-rejected', 'budget push: the active version has no budgeted amount to push');
  }
  const action = resolveOverspendAction(ctx.config);
  return accounts.map(({ account, budget_amount }) => {
    const body: Record<string, unknown> = {
      company,
      budget_against: 'Project',
      project,
      account,
      // v16 validates the header amount numerically BEFORE Frappe casts types: a decimal string 500s
      // (`'<=' not supported between str and int`, proven on a v16.33 copy). Exact: 2-dp cents < 2^53.
      budget_amount: Number(budget_amount),
      from_fiscal_year: fiscalYear,
      to_fiscal_year: fiscalYear,
      distribution_frequency: 'Monthly',
      distribute_equally: 1,
      ...resolveApplicableOn(ctx.config),
    };
    for (const field of ACTION_FIELDS) body[field] = action;
    return body;
  });
}

/**
 * ⚑ LIFECYCLE ONLY (FR-BUD-140/152). PMO owns the budget figure, so an ERP-side `budget_amount` must
 * have NO route back into PMO — this mapper deliberately does not read `accounts` at all. A Desk edit to
 * a pushed Budget is reported as divergence by the side mirror, never merged (ADR-0059 §8).
 */
export function budgetFromDoc(doc: unknown): PmoRecord {
  const d = doc as Record<string, unknown>;
  return {
    id: String(d.name),
    erp_budget_name: String(d.name),
    erp_docstatus: (d.docstatus as number | null) ?? null,
    erp_modified: (d.modified as string | null) ?? null,
    erp_amended_from: (d.amended_from as string | null) ?? null,
    fiscal_year: (d.from_fiscal_year as string | null) ?? (d.fiscal_year as string | null) ?? null,
    ...(d.from_fiscal_year === undefined ? {} : { erp_account: (d.account as string | null) ?? null }),
  };
}

/** Fields read by budgetFromDoc for the version-specific ERP list endpoint. */
export function budgetFromDocFields(versionMajor?: number): readonly string[] {
  if (versionMajor === 16) {
    return ['name', 'modified', 'docstatus', 'amended_from', 'from_fiscal_year', 'to_fiscal_year', 'account'];
  }
  return BUDGET_FROM_DOC_FIELDS;
}

/** The list-endpoint fields `budgetFromDoc` actually READS — the sweep builds its `fields=[…]` from this
 *  so the two cannot drift (the P3a idiom). ⚑ `accounts` is deliberately absent: it is a child table (the
 *  list endpoint drops it anyway, spike §10(b)) AND its amounts must never flow back into PMO. */
export const BUDGET_FROM_DOC_FIELDS = ['name', 'modified', 'docstatus', 'amended_from', 'fiscal_year'] as const;
