import { formatExactMoney } from './format';

export type ExactMoney = string;

export interface InvoiceFinanceBucket {
  currency: string;
  invoice_count: number;
  invoiced: ExactMoney | null;
  settled: ExactMoney | null;
  outstanding: ExactMoney | null;
  missing_amount: number;
  missing_outstanding: number;
  tax_basis: 'inclusive' | 'exclusive' | 'mixed';
  work_revenue: ExactMoney | null;
  missing_work: number;
}

export type ReceiptCashReason = 'allocation-unreported' | 'allocation-unresolved' | 'allocation-invalid'
  | 'currency-mismatch' | 'ambiguous-withholding' | 'source-inconsistent' | 'invoice-lifecycle' | 'posting-unconfirmed';

export type ProjectReceiptCash =
  | { state: 'known'; buckets: Array<{ currency: string; amount: ExactMoney }>; receipt_count: number }
  | { state: 'incomplete'; buckets: []; receipt_count: number; reasons: ReceiptCashReason[] }
  | { state: 'unavailable'; buckets: []; reason: 'not-reported' | 'invalid-reading' };

export interface ProjectFinances {
  project_id: string;
  cash_received?: ProjectReceiptCash;
  contract_invoiced: ExactMoney | null;
  remaining_to_invoice: ExactMoney | null;
  invoices: InvoiceFinanceBucket[];
  budget: null | {
    id: string;
    name: string;
    version: number;
    status: 'Active' | 'Draft';
    currency: string;
    amount: ExactMoney | null;
  };
  actuals: {
    currency: string | null;
    as_of: string | null;
    total: ExactMoney | null;
    excludes_restricted_rows: boolean;
    categories: Array<{
      category: string;
      mapped: boolean;
      amount: ExactMoney | null;
    }>;
  };
}

export type Margin =
  | { amount: ExactMoney; reason: null }
  | { amount: null; reason: 'different-currencies' | 'work-unavailable' | 'actuals-unavailable' | 'restricted-rows' };

export type CanonicalMarginCoverage = {
  basis: ActualPosition['basis'];
  readSucceeded: boolean;
  complete: boolean;
};

export type ActualPosition = {
  amount: ExactMoney | null;
  currency: string | null;
  asOf: string | null;
  basis: 'pmo' | 'erp' | 'unavailable';
  complete: boolean;
};

export type ProjectMoneyPositionInput = {
  projectCurrency: string;
  contractValue: number | null;
  activeBudget: number | undefined;
  ledgerBasis: ActualPosition['basis'];
  committedSpend: number | undefined;
  commitmentPending: boolean;
  commitmentError: boolean;
  actuals: ProjectFinances['actuals'] | undefined;
};

export type ProjectMoneyPosition = {
  actual: ActualPosition;
  headlineState: 'available' | 'loading' | 'partial' | 'unavailable';
  coverage: { kind: 'pmo' | 'complete' | 'partial' | 'unavailable'; mapped: number; total: number };
  comparableActual: number | null;
  contractAfterCost: ExactMoney | null;
  contractAfterCostTone: 'neg' | 'pos' | undefined;
  spendPercent: number | null;
};

export function deriveActualPosition(input: {
  ledgerBasis: 'pmo' | 'erp' | 'unavailable';
  committedSpend: number | undefined;
  commitmentPending: boolean;
  commitmentError: boolean;
  projectCurrency: string;
  actuals: ProjectFinances['actuals'] | undefined;
}): ActualPosition {
  if (input.ledgerBasis === 'pmo') {
    if (input.commitmentPending || input.commitmentError || input.committedSpend === undefined || !Number.isFinite(input.committedSpend)) {
      return { amount: null, currency: input.projectCurrency, asOf: null, basis: 'pmo', complete: false };
    }
    return { amount: moneyText(BigInt(Math.round(input.committedSpend * 100))), currency: input.projectCurrency, asOf: null, basis: 'pmo', complete: true };
  }
  if (input.ledgerBasis === 'unavailable') {
    return { amount: null, currency: null, asOf: null, basis: 'unavailable', complete: false };
  }
  const actuals = input.actuals;
  if (!actuals || !hasCompleteActuals(actuals)) {
    return { amount: null, currency: actuals?.currency ?? null, asOf: actuals?.as_of ?? null, basis: 'erp', complete: false };
  }
  return { amount: actuals.total, currency: actuals.currency, asOf: actuals.as_of, basis: 'erp', complete: true };
}

export function buildProjectMoneyPosition(input: ProjectMoneyPositionInput): ProjectMoneyPosition {
  const actual = deriveActualPosition(input);
  const categories = input.actuals?.categories ?? [];
  const mapped = categories.filter((row) => row.mapped).length;
  const coverage: ProjectMoneyPosition['coverage'] = {
    kind: actual.basis === 'pmo'
      ? 'pmo'
      : categories.length === 0
        ? 'unavailable'
        : mapped === categories.length && !input.actuals?.excludes_restricted_rows
          ? 'complete'
          : 'partial',
    mapped,
    total: categories.length,
  };
  const comparableActual = actual.complete && actual.currency === input.projectCurrency && actual.amount !== null
    ? Number(actual.amount)
    : null;
  const contractAfterCost = actual.complete
    ? deriveContractRemainingFromPosition(input.contractValue, actual, input.projectCurrency)
    : null;
  const remainingUnits = contractAfterCost === null ? null : moneyUnits(contractAfterCost);
  const contractAfterCostTone = remainingUnits === null ? undefined : remainingUnits < 0n ? 'neg' : 'pos';
  const headlineState: ProjectMoneyPosition['headlineState'] = actual.complete && actual.amount !== null && actual.currency
    ? 'available'
    : input.ledgerBasis === 'pmo' && input.commitmentPending
      ? 'loading'
      : categories.some((row) => !row.mapped) || input.actuals?.excludes_restricted_rows
        ? 'partial'
        : 'unavailable';
  const spendPercent = comparableActual !== null && (input.activeBudget ?? 0) > 0
    ? Math.round((comparableActual / (input.activeBudget ?? 0)) * 100)
    : null;

  return {
    actual,
    headlineState,
    coverage,
    comparableActual,
    contractAfterCost,
    contractAfterCostTone,
    spendPercent,
  };
}

/** A headline Actual is trustworthy only when every required category is covered. */
function categoriesComplete(
  actuals: ProjectFinances['actuals'],
  budgetedCategories?: readonly string[],
): boolean {
  const required = budgetedCategories?.length
    ? actuals.categories.filter((category) => budgetedCategories.includes(category.category))
    : actuals.categories;
  return actuals.currency !== null
    && actuals.total !== null
    && required.length > 0
    && required.every((category) => category.mapped && category.amount !== null)
    && !actuals.excludes_restricted_rows;
}

export function hasCompleteActuals(
  actuals: ProjectFinances['actuals'],
  budgetedCategories?: readonly string[],
): boolean {
  return isActualComplete({ basis: 'erp', readSucceeded: true, actuals, budgetedCategories });
}

/** PO-basis completeness is the successful read itself; an empty PO set is known zero. */
export function isActualComplete(input: {
  basis: 'pmo' | 'erp' | 'unavailable';
  readSucceeded: boolean;
  complete?: boolean | null;
  actuals?: ProjectFinances['actuals'] | null;
  categories?: ReadonlyArray<{ category: string; mapped: boolean; amount: string | null }>;
  excludesRestrictedRows?: boolean;
  coverageCount?: number | null;
  coverageTotal?: number | null;
  budgetedCategories?: readonly string[];
}): boolean {
  if (input.basis === 'pmo') return input.readSucceeded;
  if (input.basis !== 'erp' || !input.readSucceeded) return false;
  if (input.complete !== null && input.complete !== undefined) return input.complete;
  if (input.actuals) return categoriesComplete(input.actuals, input.budgetedCategories);
  if (input.coverageTotal !== null && input.coverageTotal !== undefined) {
    return input.coverageTotal > 0 && input.coverageCount !== null && input.coverageCount !== undefined
      && input.coverageCount >= input.coverageTotal && !input.excludesRestrictedRows;
  }
  const categories = input.categories ?? [];
  return categories.length > 0
    && categories.every((category) => category.mapped && category.amount !== null)
    && !input.excludesRestrictedRows;
}

export function deriveContractRemainingAfterCost(
  contractValue: number | null,
  actuals: ProjectFinances['actuals'],
  currency: string,
): ExactMoney | null {
  if (!hasCompleteActuals(actuals)) return null;
  return deriveContractRemainingFromPosition(contractValue, { amount: actuals.total, currency: actuals.currency }, currency);
}

export function deriveContractRemainingFromPosition(
  contractValue: number | null,
  actual: { amount: ExactMoney | null; currency: string | null },
  currency: string,
): ExactMoney | null {
  if (contractValue === null || !Number.isFinite(contractValue) || actual.currency !== currency) return null;
  const contract = moneyUnits(String(contractValue));
  const cost = moneyUnits(actual.amount);
  return contract === null || cost === null ? null : moneyText(contract - cost);
}

export function formatSignedExactMoney(value: ExactMoney, currency: string, locale: string): string | null {
  const units = moneyUnits(value);
  if (units === null) return null;
  const formatted = formatExactMoney(moneyText(units < 0n ? -units : units), currency, locale);
  return formatted === null ? null : `${units < 0n ? '−' : ''}${formatted}`;
}

export interface AssignInvoiceProjectInput {
  siId: string;
  projectId: string;
  oldProjectId: string | null;
}

export function moneyUnits(value: ExactMoney | null): bigint | null {
  if (value === null || !/^-?\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const units = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return negative ? -units : units;
}

export function moneyText(units: bigint): ExactMoney {
  const n = units < 0n ? -units : units;
  return `${units < 0n ? '-' : ''}${n / 100n}.${String(n % 100n).padStart(2, '0')}`;
}

const receiptCashReasons: readonly ReceiptCashReason[] = [
  'allocation-unreported', 'allocation-unresolved', 'allocation-invalid', 'currency-mismatch',
  'ambiguous-withholding', 'source-inconsistent', 'invoice-lifecycle', 'posting-unconfirmed',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isReceiptCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function unavailableCash(reason: 'not-reported' | 'invalid-reading'): ProjectReceiptCash {
  return { state: 'unavailable', buckets: [], reason };
}

/** Parse only the additive cash field; malformed cash never invalidates otherwise sound finance readings. */
export function parseProjectReceiptCash(value: unknown): ProjectReceiptCash {
  if (value === undefined) return unavailableCash('not-reported');
  if (!isRecord(value) || !isReceiptCount(value.receipt_count) || !Array.isArray(value.buckets)) {
    return unavailableCash('invalid-reading');
  }

  if (value.state === 'known') {
    const currencies = new Set<string>();
    const buckets: Array<{ currency: string; amount: ExactMoney }> = [];
    for (const item of value.buckets) {
      if (!isRecord(item) || typeof item.currency !== 'string' || !/^[A-Z]{3}$/.test(item.currency)
        || currencies.has(item.currency) || typeof item.amount !== 'string' || item.amount.startsWith('-')) {
        return unavailableCash('invalid-reading');
      }
      const units = moneyUnits(item.amount);
      if (units === null || units < 0n) return unavailableCash('invalid-reading');
      currencies.add(item.currency);
      buckets.push({ currency: item.currency, amount: item.amount });
    }
    return { state: 'known', buckets, receipt_count: value.receipt_count };
  }

  if (value.state === 'incomplete') {
    if (value.buckets.length !== 0 || !Array.isArray(value.reasons) || value.reasons.length === 0) {
      return unavailableCash('invalid-reading');
    }
    const reasons: ReceiptCashReason[] = [];
    for (const reason of value.reasons) {
      if (typeof reason !== 'string' || !receiptCashReasons.includes(reason as ReceiptCashReason) || reasons.includes(reason as ReceiptCashReason)) {
        return unavailableCash('invalid-reading');
      }
      reasons.push(reason as ReceiptCashReason);
    }
    return { state: 'incomplete', buckets: [], receipt_count: value.receipt_count, reasons };
  }

  return unavailableCash('invalid-reading');
}

export function deriveMargin(
  bucket: InvoiceFinanceBucket,
  actuals: ProjectFinances['actuals'],
  coverage?: CanonicalMarginCoverage,
): Margin {
  if (actuals.currency && bucket.currency !== actuals.currency) return { amount: null, reason: 'different-currencies' };
  if (actuals.excludes_restricted_rows) return { amount: null, reason: 'restricted-rows' };
  const revenue = moneyUnits(bucket.work_revenue);
  if (revenue === null || bucket.missing_work > 0) return { amount: null, reason: 'work-unavailable' };
  const actualsComplete = coverage
    ? coverage.complete && isActualComplete({
      basis: coverage.basis,
      readSucceeded: coverage.readSucceeded,
      complete: coverage.complete,
      actuals,
    })
    : hasCompleteActuals(actuals);
  if (!actualsComplete) return { amount: null, reason: 'actuals-unavailable' };
  const cost = moneyUnits(actuals.total);
  if (cost === null || !actuals.currency) return { amount: null, reason: 'actuals-unavailable' };
  return { amount: moneyText(revenue - cost), reason: null };
}

export function isProjectFinances(value: unknown): value is Omit<ProjectFinances, 'cash_received'> {
  const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
  const exact = (v: unknown) => v === null || (typeof v === 'string' && moneyUnits(v) !== null);
  const count = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0;
  const currency = (v: unknown) => typeof v === 'string' && /^[A-Z]{3}$/.test(v);
  const uuid = (v: unknown) => typeof v === 'string'
    && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
  if (!object(value) || !uuid(value.project_id) || !exact(value.contract_invoiced) || !exact(value.remaining_to_invoice)
    || !Array.isArray(value.invoices) || !value.invoices.every((v) => object(v) && currency(v.currency)
      && count(v.invoice_count) && count(v.missing_amount) && count(v.missing_outstanding) && count(v.missing_work)
      && ['inclusive', 'exclusive', 'mixed'].includes(String(v.tax_basis)) && exact(v.invoiced) && exact(v.settled)
      && exact(v.outstanding) && exact(v.work_revenue))) return false;
  const budget = value.budget;
  if (budget !== null && (!object(budget) || !uuid(budget.id) || typeof budget.name !== 'string' || !count(budget.version)
    || (budget.status !== 'Active' && budget.status !== 'Draft') || !currency(budget.currency) || !exact(budget.amount))) return false;
  const actuals = value.actuals;
  return object(actuals) && (actuals.currency === null || currency(actuals.currency))
    && (actuals.as_of === null || (typeof actuals.as_of === 'string' && Number.isFinite(Date.parse(actuals.as_of))))
    && exact(actuals.total) && typeof actuals.excludes_restricted_rows === 'boolean' && Array.isArray(actuals.categories)
    && actuals.categories.every((v) => object(v) && typeof v.category === 'string'
      && typeof v.mapped === 'boolean' && exact(v.amount));
}

export { formatExactMoney };
