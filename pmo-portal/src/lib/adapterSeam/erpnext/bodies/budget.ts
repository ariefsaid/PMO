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

export function budgetToBody(rec: PmoRecord, ctx: ErpCtx): unknown {
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
    fiscal_year: (d.fiscal_year as string | null) ?? null,
  };
}

/** The list-endpoint fields `budgetFromDoc` actually READS — the sweep builds its `fields=[…]` from this
 *  so the two cannot drift (the P3a idiom). ⚑ `accounts` is deliberately absent: it is a child table (the
 *  list endpoint drops it anyway, spike §10(b)) AND its amounts must never flow back into PMO. */
export const BUDGET_FROM_DOC_FIELDS = ['name', 'modified', 'docstatus', 'amended_from', 'fiscal_year'] as const;
