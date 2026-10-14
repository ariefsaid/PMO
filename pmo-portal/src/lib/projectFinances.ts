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

export function formatExactMoney(value: ExactMoney | null, currency: string, locale: string): string | null {
  const units = moneyUnits(value);
  if (units === null || !/^[A-Z]{3}$/.test(currency)) return null;
  const absolute = units < 0n ? -units : units;
  try {
    const parts = new Intl.NumberFormat(locale, {
      style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).formatToParts(absolute / 100n);
    const body = parts.map((part) => part.type === 'fraction'
      ? String(absolute % 100n).padStart(2, '0')
      : part.value).join('');
    return units < 0n ? `−${body}` : body;
  } catch {
    return null;
  }
}
