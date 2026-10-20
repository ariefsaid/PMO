import { useId, type ReactNode } from 'react';
import { Card, CardHead, CardPad } from '@/src/components/ui/Card';
import { DataTable, type Column } from '@/src/components/ui/DataTable';
import { ListState } from '@/src/components/ui/ListState';
import type { NativeReportColumn, NativeReportScalar, StatementReportPair } from '@/src/lib/adapterSeam/erpnext/statementReports';
import { formatDateOnly, formatDateTime } from '@/src/lib/format';
import {
  formatNativeStatementAmount,
  hasNativeStatementEmphasis,
  plainNativeStatementLabel,
} from '@/src/lib/nativeStatementPresentation';

export interface NativeStatementPairProps {
  pair: Readonly<Pick<StatementReportPair, 'current' | 'prior'>>;
  reportTitle: string;
  labels: {
    current: string;
    prior: string;
    values: string;
    noActivity: string;
    noActivityDescription: string;
    notProvided: string;
    collected: string;
    asAt: string;
  };
}

interface NativeDisplayRow {
  readonly ordinal: number;
  readonly source: Readonly<Record<string, NativeReportScalar>>;
}

type NativeRowSegment =
  | { kind: 'rows'; startOrdinal: number; rows: NativeDisplayRow[] }
  | { kind: 'separator'; ordinal: number };

function partitionNativeRows(rows: NativeReportColumn['rows']): NativeRowSegment[] {
  const segments: NativeRowSegment[] = [];
  let run: NativeDisplayRow[] = [];
  const flushRun = () => {
    if (run.length > 0) {
      segments.push({ kind: 'rows', startOrdinal: run[0].ordinal, rows: run });
      run = [];
    }
  };

  rows.forEach((source, ordinal) => {
    if (Object.keys(source).length === 0) {
      flushRun();
      segments.push({ kind: 'separator', ordinal });
    } else {
      run.push({ ordinal, source });
    }
  });
  flushRun();
  return segments;
}

function primaryLabel(row: Readonly<Record<string, NativeReportScalar>>): string {
  for (const field of ['account_name', 'acc_name'] as const) {
    const value = row[field];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return typeof row.account === 'string' ? row.account : '';
}

function sideDateRange(side: NativeReportColumn): string {
  return `${formatDateOnly(side.period.fromDate)} – ${formatDateOnly(side.period.toDate)}`;
}

function cellValue(
  row: NativeDisplayRow,
  column: NativeReportColumn['columns'][number],
  labels: NativeStatementPairProps['labels'],
): ReactNode {
  const present = Object.hasOwn(row.source, column.fieldname);
  const value = row.source[column.fieldname];
  if (!present || value === null) {
    return (
      <span aria-label={`${labels.notProvided}: ${plainNativeStatementLabel(column.label)}`} className="tabular">
        —
      </span>
    );
  }

  if (column.type === 'currency') {
    if (typeof value !== 'string') throw new TypeError('Native currency cell is not a lexical decimal token');
    return (
      <span className="block min-w-0 whitespace-normal break-words text-right tabular">
        {formatNativeStatementAmount(value)}
      </span>
    );
  }

  const display = typeof value === 'string' ? value : String(value);
  return <span className="block min-w-0 whitespace-normal break-words">{display}</span>;
}

function NativeReportPanel({
  side,
  sideLabel,
  reportTitle,
  labels,
}: {
  side: NativeReportColumn;
  sideLabel: string;
  reportTitle: string;
  labels: NativeStatementPairProps['labels'];
}) {
  const headingId = useId();
  const range = sideDateRange(side);
  const endDate = formatDateOnly(side.period.toDate);
  const isBalanceSheet = side.reportName === 'Balance Sheet';
  const accountColumn = side.columns.find((column) => column.fieldname === 'account');
  if (!accountColumn) throw new TypeError('Native statement report has no account column');
  const valueColumns = side.columns.filter((column) => column.fieldname !== 'account' && column.hidden !== true);
  const accountNumberColumn = side.columns.find((column) => column.fieldname === 'acc_number');
  const segments = partitionNativeRows(side.rows);
  const acquiredAt = new Date(side.provenance.acquiredAt);
  const collectedAt = Number.isNaN(acquiredAt.getTime()) ? null : formatDateTime(acquiredAt);
  const tableColumns: Column<NativeDisplayRow>[] = [
    {
      key: 'account',
      header: plainNativeStatementLabel(accountColumn.label),
      cell: (displayRow) => {
        const { source } = displayRow;
        const originalLabel = primaryLabel(source);
        const label = plainNativeStatementLabel(originalLabel);
        const emphasis = hasNativeStatementEmphasis(originalLabel)
          || source.is_group === true
          || source.is_group_account === true;
        const accountNumber = accountNumberColumn === undefined
          && typeof source.acc_number === 'string'
          && source.acc_number.trim() !== ''
          ? source.acc_number
          : null;
        const indent = typeof source.indent === 'number' ? source.indent : 0;
        return (
          <div
            className="min-w-0 whitespace-normal break-words"
            style={indent > 0 ? { paddingInlineStart: `calc(var(--spacing) * ${indent})` } : undefined}
          >
            <span className={emphasis ? 'font-semibold' : undefined}>{label}</span>
            {accountNumber !== null && (
              <span className="block text-xs font-normal text-muted-foreground">{accountNumber}</span>
            )}
          </div>
        );
      },
    },
    {
      key: 'values',
      header: labels.values,
      colClassName: 'max-md:col-span-2',
      cell: (displayRow) => {
        const label = plainNativeStatementLabel(primaryLabel(displayRow.source));
        return (
          <div
            role="group"
            aria-label={[sideLabel, range, label].filter(Boolean).join(' ')}
            className="min-w-0"
          >
            <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
              {valueColumns.map((column) => (
                <div key={column.fieldname} className="contents">
                  <dt className="min-w-0 whitespace-normal break-words text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                    {plainNativeStatementLabel(column.label)}
                  </dt>
                  <dd className={`min-w-0 whitespace-normal break-words text-[13.5px] text-foreground ${column.type === 'currency' ? 'text-right tabular' : 'text-left'}`}>
                    {cellValue(displayRow, column, labels)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        );
      },
    },
  ];

  const contents = side.rows.length === 0
    ? (
      <ListState
        variant="empty"
        title={labels.noActivity}
        sub={labels.noActivityDescription}
      />
    )
    : segments.map((segment) => {
      if (segment.kind === 'separator') {
        return <hr key={`separator-${side.side}-${segment.ordinal}`} className="my-3 border-border" />;
      }
      return (
        <DataTable
          key={`run-${side.side}-${segment.startOrdinal}`}
          rows={segment.rows}
          columns={tableColumns}
          rowKey={(row) => `${side.side}-${row.ordinal}`}
          accessibleName={`${sideLabel} ${range} ${labels.values}`}
          className="min-w-0 rounded-lg"
        tableId="components-financial-statements-nativestatementpair-table" />
      );
    });

  return (
    <section aria-labelledby={headingId} className="min-w-0">
      <Card className="min-w-0">
        <CardHead level={3} id={headingId} className="min-w-0 flex-wrap break-words">
          {reportTitle} — {sideLabel}
        </CardHead>
        <CardPad className="flex min-w-0 flex-col gap-3">
          {isBalanceSheet ? (
            <>
              <p className="min-w-0 break-words text-sm">{labels.asAt} {endDate}</p>
              <p className="min-w-0 break-words text-sm text-muted-foreground">{range}</p>
            </>
          ) : (
            <p className="min-w-0 break-words text-sm text-muted-foreground">{range}</p>
          )}
          {collectedAt !== null && (
            <p className="min-w-0 break-words text-[11px] text-muted-foreground">
              {labels.collected} {collectedAt}
            </p>
          )}
          <div className="flex min-w-0 flex-col gap-3">
            {contents}
          </div>
        </CardPad>
      </Card>
    </section>
  );
}

export function NativeStatementPair({ pair, reportTitle, labels }: NativeStatementPairProps) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
      <NativeReportPanel
        side={pair.current}
        sideLabel={labels.current}
        reportTitle={reportTitle}
        labels={labels}
      />
      <NativeReportPanel
        side={pair.prior}
        sideLabel={labels.prior}
        reportTitle={reportTitle}
        labels={labels}
      />
    </div>
  );
}
