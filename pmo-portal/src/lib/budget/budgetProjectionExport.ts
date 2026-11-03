import type { BudgetComparisonRow, BudgetProjectionCellRow } from '@/src/lib/repositories/budgetProjection';

export type BudgetProjectionExport =
  | { scope: { kind: 'all' }; rows: BudgetComparisonRow[] }
  | { scope: { kind: 'year'; year: string }; rows: BudgetProjectionCellRow[] };

interface BudgetProjectionExportOptions {
  budgetCurrency: string;
  projectCurrency: string;
  categoryLabel: (category: string) => string;
}

const quoteCsvCell = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;

export function buildBudgetProjectionCsv(
  payload: BudgetProjectionExport,
  { budgetCurrency, projectCurrency, categoryLabel }: BudgetProjectionExportOptions,
): string {
  const headers = payload.scope.kind === 'all'
    ? ['Category', `Approved total (${budgetCurrency})`, `Recorded to date (${projectCurrency})`, `Remaining (${projectCurrency})`, '% recorded']
    : ['Category', `Budget (${budgetCurrency})`, `Spent (${projectCurrency})`, `Cost to finish (${projectCurrency})`, `Forecast final (${projectCurrency})`, `Forecast remaining (${projectCurrency})`];
  const rows = payload.scope.kind === 'all'
    ? (payload.rows as BudgetComparisonRow[]).map((row) => [
      categoryLabel(row.category), row.budgetTotal ?? '', row.recorded ?? '', row.remaining ?? '', row.percentUsed === null ? '' : row.percentUsed * 100,
    ])
    : (payload.rows as BudgetProjectionCellRow[]).map((row) => [
      categoryLabel(row.category), row.pmoBudgetAmount ?? '', row.actualsToDate ?? '', row.pmoEtc, row.projectedFinalCost ?? '', row.projectedVariance ?? '',
    ]);
  return [headers, ...rows].map((row) => row.map(quoteCsvCell).join(',')).join('\r\n');
}
