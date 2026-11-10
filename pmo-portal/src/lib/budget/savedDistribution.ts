import { byDays, fromAmounts, fromPercents, yearsInSpan, type DistributionResult, type FiscalYearSpan } from '@/src/lib/budget/budgetDistribution';
import { formatExactCents, parseExactCents } from '@/src/lib/exactDecimal';
import { normalizeLocalizedDecimal } from '@/src/lib/format';
import type {
  BudgetCategoryOverride,
  BudgetDistributionMethod,
  BudgetDistributionPlan,
  BudgetDistributionPlanRow,
  BudgetLineItemRow,
} from '@/src/lib/db/budgets';

/** The Budget tab's readiness vocabulary for a whole-project distribution (also read by the Finance hub, #1273). */
export type DistributionReadinessStatus = 'loading' | 'error' | 'absent' | 'current' | 'stale' | 'dirty' | 'invalid' | 'saving';

type CategoryLine = Pick<BudgetLineItemRow, 'category' | 'budgeted_amount'>;

export interface CategoryTotal {
  category: CategoryLine['category'];
  cents: bigint;
}

export interface DistributionValidationIssue {
  scope: 'shared' | 'category';
  category?: string;
  year?: string;
  code: 'missing' | 'invalid' | 'negative' | 'out-of-range' | 'sum-mismatch';
  method: BudgetDistributionMethod;
}

export class DistributionValidationError extends Error {
  constructor(readonly issues: DistributionValidationIssue[]) {
    super('Distribution inputs need review.');
  }
}

export function categoryTotals(lines: readonly CategoryLine[]): CategoryTotal[] {
  const totals = new Map<CategoryLine['category'], bigint>();
  for (const line of lines) {
    const cents = parseExactCents(String(line.budgeted_amount));
    if (cents === null || cents < 0n) throw new Error('A budget line has an invalid exact amount.');
    totals.set(line.category, (totals.get(line.category) ?? 0n) + cents);
  }
  return [...totals.entries()]
    .map(([category, cents]) => ({ category, cents }))
    .sort((left, right) => String(left.category).localeCompare(String(right.category)));
}

type DecimalNormalizer = (value: string, scale: 2 | 4) => string | null;

function normalizeStoredDecimal(raw: string, scale: 2 | 4): string | null {
  const match = raw.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match || (match[3]?.length ?? 0) > scale) return null;
  const integer = match[2].replace(/^0+(?=\d)/, '');
  const fraction = (match[3] ?? '').replace(/0+$/, '');
  return `${match[1]}${integer}${fraction ? `.${fraction}` : ''}`;
}

function inputObject(years: readonly FiscalYearSpan[], values: Record<string, string>, scale: 2 | 4, normalize: DecimalNormalizer = normalizeLocalizedDecimal): Record<string, string> | null {
  const result: Record<string, string> = {};
  for (const year of years) {
    const value = normalize(values[year.name] ?? '', scale);
    if (value === null) return null;
    result[year.name] = value;
  }
  return result;
}

function validatedInputObject(
  years: readonly FiscalYearSpan[],
  values: Record<string, string>,
  scale: 2 | 4,
  scope: DistributionValidationIssue['scope'],
  method: BudgetDistributionMethod,
  category?: string,
  normalize: DecimalNormalizer = normalizeLocalizedDecimal,
): { inputs: Record<string, string> | null; issues: DistributionValidationIssue[] } {
  const inputs: Record<string, string> = {};
  const issues: DistributionValidationIssue[] = [];
  for (const year of years) {
    const raw = values[year.name] ?? '';
    if (raw.trim() === '') {
      issues.push({ scope, category, year: year.name, code: 'missing', method });
      continue;
    }
    const normalized = normalize(raw, scale);
    if (normalized === null || !Number.isFinite(Number(normalized))) {
      issues.push({ scope, category, year: year.name, code: 'invalid', method });
      continue;
    }
    if (Number(normalized) < 0) {
      issues.push({ scope, category, year: year.name, code: 'negative', method });
      continue;
    }
    inputs[year.name] = normalized;
  }
  return { inputs: issues.length === 0 ? inputs : null, issues };
}

function resolvedRows(
  total: bigint,
  method: BudgetDistributionMethod,
  inputs: Record<string, string>,
  years: readonly FiscalYearSpan[],
  projectStart: string,
  projectEnd: string | null,
  proportionalAmounts: boolean,
  normalize: DecimalNormalizer = normalizeLocalizedDecimal,
): DistributionResult | null {
  const totalText = formatExactCents(total);
  if (method === 'by_days') {
    try {
      return { ok: true, rows: byDays(totalText, projectStart, projectEnd, years) };
    } catch {
      return { ok: false, errors: [{ code: 'invalid' }] };
    }
  }
  if (method === 'percent_by_year') {
    const normalized = inputObject(years, inputs, 4, normalize);
    return normalized === null ? null : fromPercents(totalText, years.map((year) => normalized[year.name]), years);
  }
  const normalized = inputObject(years, inputs, 2, normalize);
  return normalized === null
    ? null
    : fromAmounts(totalText, years.map((year) => normalized[year.name]), years, { proportional: proportionalAmounts });
}

export function planFor(
  categories: readonly CategoryTotal[],
  years: readonly FiscalYearSpan[],
  projectStart: string,
  projectEnd: string | null,
  method: BudgetDistributionMethod,
  globalValues: Record<string, string>,
  overrideValues: Record<string, BudgetCategoryOverride>,
  canonicalInputs = false,
): BudgetDistributionPlan {
  const normalize: DecimalNormalizer = canonicalInputs ? normalizeStoredDecimal : normalizeLocalizedDecimal;
  const issues: DistributionValidationIssue[] = [];
  const globalInputResult = method === 'by_days'
    ? { inputs: {} as Record<string, string>, issues: [] as DistributionValidationIssue[] }
    : validatedInputObject(years, globalValues, method === 'percent_by_year' ? 4 : 2, 'shared', method, undefined, normalize);
  issues.push(...globalInputResult.issues);
  const globalInputs = globalInputResult.inputs ?? {};
  const rows: BudgetDistributionPlanRow[] = [];
  const categoryOverrides: Record<string, BudgetCategoryOverride> = {};

  for (const category of categories) {
    const override = overrideValues[category.category];
    const selectedMethod = override?.method ?? method;
    const values = override?.inputs ?? globalValues;
    const normalizedResult = selectedMethod === 'by_days'
      ? { inputs: {} as Record<string, string>, issues: [] as DistributionValidationIssue[] }
      : override
        ? validatedInputObject(years, values, selectedMethod === 'percent_by_year' ? 4 : 2, 'category', selectedMethod, category.category, normalize)
        : globalInputResult;
    issues.push(...(override ? normalizedResult.issues : []));
    if (normalizedResult.inputs === null) continue;
    const normalized = normalizedResult.inputs;
    if (override) categoryOverrides[category.category] = { method: selectedMethod, inputs: normalized };
    if (!override && globalInputResult.inputs === null) continue;
    const distribution = resolvedRows(
      category.cents,
      selectedMethod,
      normalized,
      years,
      projectStart,
      projectEnd,
      !override && selectedMethod === 'amount_by_year',
      normalize,
    );
    if (!distribution || !distribution.ok) {
      const distributionErrors = distribution && !distribution.ok ? distribution.errors : [{ code: 'invalid' as const }];
      for (const distributionError of distributionErrors) {
        issues.push({
          scope: override ? 'category' : 'shared',
          category: override ? category.category : undefined,
          year: distributionError.year,
          code: distributionError.code,
          method: selectedMethod,
        });
      }
      continue;
    }
    if (distribution.rows.length !== years.length) throw new Error('The fiscal-year preview is incomplete.');
    distribution.rows.forEach((row, ordinal) => rows.push({
      category: category.category,
      fiscal_year: row.year,
      ordinal,
      amount: row.amount,
      method: selectedMethod,
      is_override: Boolean(override),
    }));
  }

  const uniqueIssues = [...new Map(issues.map((issue) => [
    `${issue.scope}:${issue.category ?? ''}:${issue.year ?? ''}:${issue.method}:${issue.code}`,
    issue,
  ])).values()];
  if (uniqueIssues.length > 0) throw new DistributionValidationError(uniqueIssues);
  if (rows.length !== categories.length * years.length) throw new Error('The fiscal-year preview is incomplete.');

  return {
    method,
    inputs: globalInputs,
    categoryOverrides,
    basis: {
      projectStart,
      projectEnd,
      years: years.map(({ name, start, end }) => ({ name, start, end })),
    },
    rows,
  };
}

function isSavedPlanCurrent(
  plan: BudgetDistributionPlan,
  categories: readonly CategoryTotal[],
  years: readonly FiscalYearSpan[],
  projectStart: string,
  projectEnd: string | null,
): boolean {
  if (plan.basis.projectStart !== projectStart || plan.basis.projectEnd !== projectEnd) return false;
  if (plan.basis.years.length !== years.length || plan.basis.years.some((year, index) =>
    year.name !== years[index].name || year.start !== years[index].start || year.end !== years[index].end)) return false;
  if (plan.rows.length !== categories.length * years.length) return false;
  try {
    const expected = planFor(categories, years, projectStart, projectEnd, plan.method, plan.inputs, plan.categoryOverrides, true);
    return stablePlan(expected) === stablePlan(plan);
  } catch {
    return false;
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function stablePlan(plan: BudgetDistributionPlan): string {
  const rows = [...plan.rows].sort((left, right) =>
    left.category.localeCompare(right.category) || left.ordinal - right.ordinal || left.fiscal_year.localeCompare(right.fiscal_year));
  return stableJson({ ...plan, rows });
}

/**
 * The ONE rule for "the saved distribution still matches this draft": same lines, project dates and live ERPNext
 * fiscal years. The Budget tab (DistributionGrid) and the Finance hub's bulk activation both gate on it.
 */
export function savedPlanMatchesDraft(
  plan: BudgetDistributionPlan,
  lines: readonly CategoryLine[],
  projectStart: string | null,
  projectEnd: string | null,
  fiscalYears: readonly FiscalYearSpan[] | null,
): boolean {
  if (!projectStart || !fiscalYears) return false;
  try {
    return isSavedPlanCurrent(plan, categoryTotals(lines), yearsInSpan(projectStart, projectEnd, fiscalYears), projectStart, projectEnd);
  } catch {
    return false;
  }
}
