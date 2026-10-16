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

export interface ProjectFinances {
  project_id: string;
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

export type ActualPosition = {
  amount: ExactMoney | null;
  currency: string | null;
  asOf: string | null;
  basis: 'pmo' | 'erp' | 'unavailable';
  complete: boolean;
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

/** A headline Actual is trustworthy only when every reported category is covered. */
export function hasCompleteActuals(actuals: ProjectFinances['actuals']): boolean {
  return actuals.currency !== null
    && actuals.total !== null
    && actuals.categories.length > 0
    && actuals.categories.every((category) => category.mapped)
    && !actuals.excludes_restricted_rows;
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

export function deriveMargin(bucket: InvoiceFinanceBucket, actuals: ProjectFinances['actuals']): Margin {
  if (actuals.currency && bucket.currency !== actuals.currency) return { amount: null, reason: 'different-currencies' };
  if (actuals.excludes_restricted_rows) return { amount: null, reason: 'restricted-rows' };
  const revenue = moneyUnits(bucket.work_revenue);
  if (revenue === null || bucket.missing_work > 0) return { amount: null, reason: 'work-unavailable' };
  if (!hasCompleteActuals(actuals)) return { amount: null, reason: 'actuals-unavailable' };
  const cost = moneyUnits(actuals.total);
  if (cost === null || !actuals.currency) return { amount: null, reason: 'actuals-unavailable' };
  return { amount: moneyText(revenue - cost), reason: null };
}

export function isProjectFinances(value: unknown): value is ProjectFinances {
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
