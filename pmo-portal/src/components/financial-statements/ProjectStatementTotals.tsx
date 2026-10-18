import { DataTable, type Column } from '@/src/components/ui/DataTable';
import type { NativeProjectStatementTotals, StatementReportPeriod } from '@/src/lib/adapterSeam/erpnext/statementReports';
import { formatDateOnly } from '@/src/lib/format';
import { formatNativeStatementAmount } from '@/src/lib/nativeStatementPresentation';

export interface ProjectStatementTotalsProps {
  current: Readonly<NativeProjectStatementTotals>;
  prior: Readonly<NativeProjectStatementTotals>;
  periods: {
    current: Pick<StatementReportPeriod, 'fromDate' | 'toDate'>;
    prior: Pick<StatementReportPeriod, 'fromDate' | 'toDate'>;
  };
  labels: {
    current: string;
    prior: string;
    income: string;
    expense: string;
    net: string;
    amounts: string;
  };
}

interface ProjectTotalRow {
  readonly key: 'income' | 'expense' | 'net';
  readonly label: string;
}

function periodCaption(
  sideLabel: string,
  period: Pick<StatementReportPeriod, 'fromDate' | 'toDate'>,
  currency: NativeProjectStatementTotals['currency'],
): string {
  return `${sideLabel} · ${formatDateOnly(period.fromDate)} – ${formatDateOnly(period.toDate)} · ${currency}`;
}

export function ProjectStatementTotals({ current, prior, periods, labels }: ProjectStatementTotalsProps) {
  const rows: ProjectTotalRow[] = [
    { key: 'income', label: labels.income },
    { key: 'expense', label: labels.expense },
    { key: 'net', label: labels.net },
  ];
  const amountFor = (totals: Readonly<NativeProjectStatementTotals>, key: ProjectTotalRow['key']) => {
    if (key === 'income') return totals.income;
    if (key === 'expense') return totals.expense;
    return totals.net;
  };
  const columns: Column<ProjectTotalRow>[] = [
    {
      key: 'amount',
      header: labels.amounts,
      cell: (row) => row.label,
    },
    {
      key: 'current',
      header: periodCaption(labels.current, periods.current, current.currency),
      align: 'num',
      cell: (row) => (
        <span className="block min-w-0 whitespace-normal break-words text-right tabular">
          {formatNativeStatementAmount(amountFor(current, row.key))}
        </span>
      ),
    },
    {
      key: 'prior',
      header: periodCaption(labels.prior, periods.prior, prior.currency),
      align: 'num',
      cell: (row) => (
        <span className="block min-w-0 whitespace-normal break-words text-right tabular">
          {formatNativeStatementAmount(amountFor(prior, row.key))}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(row) => row.key}
      accessibleName={labels.amounts}
    />
  );
}
