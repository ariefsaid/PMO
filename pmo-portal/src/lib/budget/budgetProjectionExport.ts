import { formatExactCents } from '@/src/lib/exactDecimal';
import type { BudgetComparisonRow, BudgetProjectionCellRow } from '@/src/lib/repositories/budgetProjection';

export type BudgetProjectionExport =
  | { scope: { kind: 'all' }; rows: BudgetComparisonRow[] }
  | { scope: { kind: 'year'; year: string }; rows: BudgetProjectionCellRow[] };

interface BudgetProjectionExportOptions {
  budgetCurrency: string;
  projectCurrency: string;
  categoryLabel: (category: string) => string;
}

/** Fraction (0.57) to a two-decimal percent string ("57.00"), shifted in integers so binary floats never leak. */
function exactPercent(fraction: number): string {
  const [whole, frac] = Math.abs(fraction).toFixed(10).split('.');
  const scaled = BigInt(whole) * 10n ** 10n + BigInt(frac); // fraction * 1e10
  const cents = (scaled + 500_000n) / 1_000_000n; // percent * 100, half-up
  return formatExactCents(fraction < 0 ? -cents : cents);
}

const quoteCsvCell = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;

export function buildBudgetProjectionCsv(
  payload: BudgetProjectionExport,
  { budgetCurrency, projectCurrency, categoryLabel }: BudgetProjectionExportOptions,
): string {
  const compatibleCurrencyBasis = budgetCurrency === projectCurrency;
  const annualFiscalYear = payload.scope.kind === 'year' ? payload.scope.year : '';
  const comparisonHeaders = [
    'Scope', 'Fiscal year', 'Category', `Approved total (${budgetCurrency})`, 'Budget source',
    `Recorded to date (${projectCurrency})`, 'Recorded source', 'Recorded as of',
    compatibleCurrencyBasis ? `Remaining (${projectCurrency})` : 'Remaining (Unavailable across currencies)',
    compatibleCurrencyBasis ? '% recorded' : '% recorded (Unavailable across currencies)',
  ];
  const annualHeaders = [
    'Scope', 'Fiscal year', 'Category', `Budget (${budgetCurrency})`, 'Budget source',
    `Spent (${projectCurrency})`, 'Recorded source', 'Recorded as of',
    `Cost to finish (${projectCurrency})`, `Forecast final (${projectCurrency})`,
    compatibleCurrencyBasis ? `Forecast remaining (${projectCurrency})` : 'Forecast remaining (Unavailable across currencies)',
  ];
  const headers = payload.scope.kind === 'all' ? comparisonHeaders : annualHeaders;
  const rows = payload.scope.kind === 'all'
    ? (payload.rows as BudgetComparisonRow[]).map((row) => [
      'All years (project to date)', '', categoryLabel(row.category), row.budgetTotal ?? '', 'Active budget version',
      row.recorded ?? '', row.recorded === null
        ? !row.mapped ? 'No ledger account mapped' : !row.hasLedger ? 'No ledger reading' : 'ERP ledger amount unavailable'
        : 'ERP ledger',
      row.recordedAsOf ?? '', compatibleCurrencyBasis ? row.remaining ?? '' : '',
      compatibleCurrencyBasis && row.percentUsed !== null ? exactPercent(row.percentUsed) : '',
    ])
    : (payload.rows as BudgetProjectionCellRow[]).map((row) => [
      'Fiscal year', annualFiscalYear, categoryLabel(row.category), row.pmoBudgetAmount ?? '', 'Active budget version',
      row.actualsToDate ?? '', 'ERP ledger', row.actualsAsOf ?? '', row.pmoEtc, row.projectedFinalCost ?? '',
      compatibleCurrencyBasis ? row.projectedVariance ?? '' : '',
    ]);
  return [headers, ...rows].map((row) => row.map(quoteCsvCell).join(',')).join('\r\n');
}
