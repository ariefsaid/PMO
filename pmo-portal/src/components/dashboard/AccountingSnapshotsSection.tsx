import React from 'react';
import { Card, CardHead } from '@/src/components/ui/Card';
import { DataTable, type Column } from '@/src/components/ui/DataTable';
import { ListState } from '@/src/components/ui/ListState';
import { AccountingSnapshotProvenance } from '@/src/components/AccountingSnapshotProvenance';
import { formatCurrency } from '@/src/lib/format';
import type { ErpActualsSnapshotRow, ErpAgingSnapshotRow } from '@/src/lib/db/erpSnapshots';

/**
 * AccountingSnapshotsSection (task FIX-2, Discover CRITICAL 2 — ADR-0048) — the read-only actuals /
 * AP aging / AR aging snapshot surface, mounted on the Finance dashboard.
 *
 * Ledger-sourced-display rule (ADR-0048): every figure below is a mirrored ERPNext value rendered
 * AS-IS (or summed verbatim, for actuals `net`) — this component never recomputes, re-buckets, or
 * derives an accounting number. The empty state is the honest default: an org that has never run an
 * ERPNext accounting refresh (i.e. every non-flipped org, FR-ENA-004) sees "No … snapshot yet", never
 * a fabricated $0.00.
 *
 * DESIGN.md tokens + the shared Card/DataTable/ListState primitives only.
 */

export interface AccountingSnapshotsSectionProps {
  actuals: ErpActualsSnapshotRow[];
  actualsPending?: boolean;
  actualsError?: boolean;
  onRetryActuals?: () => void;

  apAging: ErpAgingSnapshotRow[];
  apAgingPending?: boolean;
  apAgingError?: boolean;
  onRetryApAging?: () => void;

  arAging: ErpAgingSnapshotRow[];
  arAgingPending?: boolean;
  arAgingError?: boolean;
  onRetryArAging?: () => void;
}

const AGING_COLUMNS: Column<ErpAgingSnapshotRow>[] = [
  {
    key: 'party',
    header: 'Party',
    cell: (r) => <span className="font-medium">{r.party ?? '—'}</span>,
  },
  {
    key: 'current',
    header: 'Current',
    align: 'num',
    cell: (r) => <span>{formatCurrency(r.current ?? 0)}</span>,
  },
  {
    key: 'b0_30',
    header: '0–30',
    align: 'num',
    cell: (r) => <span>{formatCurrency(r.bucket0to30 ?? 0)}</span>,
  },
  {
    key: 'b31_60',
    header: '31–60',
    align: 'num',
    cell: (r) => <span>{formatCurrency(r.bucket31to60 ?? 0)}</span>,
  },
  {
    key: 'b61_90',
    header: '61–90',
    align: 'num',
    cell: (r) => <span>{formatCurrency(r.bucket61to90 ?? 0)}</span>,
  },
  {
    key: 'b90plus',
    header: '90+',
    align: 'num',
    cell: (r) => <span>{formatCurrency(r.bucketOver90 ?? 0)}</span>,
  },
  {
    key: 'total',
    header: 'Total outstanding',
    align: 'num',
    cell: (r) => <span className="font-semibold">{formatCurrency(r.totalOutstanding ?? 0)}</span>,
  },
];

const ACTUALS_COLUMNS: Column<ErpActualsSnapshotRow>[] = [
  {
    key: 'account',
    header: 'Account',
    cell: (r) => <span className="font-medium">{r.account ?? '—'}</span>,
  },
  {
    key: 'costCenter',
    header: 'Cost center',
    cell: (r) => <span className="text-muted-foreground">{r.costCenter ?? '—'}</span>,
  },
  {
    key: 'fiscalYear',
    header: 'Fiscal year',
    cell: (r) => <span className="text-muted-foreground">{r.fiscalYear ?? '—'}</span>,
  },
  {
    key: 'net',
    header: 'Net',
    align: 'num',
    cell: (r) => <span className="font-semibold">{formatCurrency(r.net ?? 0)}</span>,
  },
];

/** One snapshot subsection: title, provenance strip (from the first row — snapshot-replace keeps
 *  every own-org row on one shared `snapshot_id`/`as_of`), and either the empty/loading/error state
 *  or the populated table. */
function SnapshotBlock<Row extends { asOf: string; sourceReport: string | null }>({
  title,
  emptyLabel,
  rows,
  pending,
  isError,
  onRetry,
  columns,
  rowKey,
  reportVersion,
}: {
  title: string;
  emptyLabel: string;
  rows: Row[];
  pending?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  columns: Column<Row>[];
  rowKey: (r: Row) => string;
  reportVersion?: string | null;
}) {
  const first = rows[0];
  return (
    <Card seam>
      <CardHead className="rounded-t-lg">{title}</CardHead>
      <div className="px-4 pb-4 pt-2">
        {first && (
          <AccountingSnapshotProvenance
            asOf={first.asOf}
            sourceReport={first.sourceReport}
            reportVersion={reportVersion}
            className="mb-2.5"
          />
        )}
        {isError ? (
          <ListState variant="error" title={`Couldn't load ${title.toLowerCase()}`} onRetry={onRetry} />
        ) : pending ? (
          <ListState variant="loading" rows={3} />
        ) : rows.length === 0 ? (
          <ListState variant="empty" icon="doc" title={emptyLabel} sub="Refresh the ERPNext binding to populate this snapshot." />
        ) : (
          <DataTable<Row> rows={rows} columns={columns} rowKey={rowKey} className="rounded-t-none border-t-0" />
        )}
      </div>
    </Card>
  );
}

export const AccountingSnapshotsSection: React.FC<AccountingSnapshotsSectionProps> = ({
  actuals,
  actualsPending,
  actualsError,
  onRetryActuals,
  apAging,
  apAgingPending,
  apAgingError,
  onRetryApAging,
  arAging,
  arAgingPending,
  arAgingError,
  onRetryArAging,
}) => (
  <section aria-label="Accounting snapshots" className="flex flex-col gap-4">
    <SnapshotBlock<ErpActualsSnapshotRow>
      title="Actuals (ERP ledger)"
      emptyLabel="No actuals snapshot yet"
      rows={actuals}
      pending={actualsPending}
      isError={actualsError}
      onRetry={onRetryActuals}
      columns={ACTUALS_COLUMNS}
      // ⚑ Audit round 11 (NEW-2): the key must carry the WHOLE grain. `erp_actuals_snapshot` is keyed
      // by (project, cost_centre, account, fiscal_year); this omitted project and fiscal year, so two
      // projects — or a project and the UNATTRIBUTED bucket — on one account+FY collided into one React
      // key while rendering as indistinguishable money rows (no Project column exists). `\u0000` as the
      // separator so concatenation cannot alias two different tuples into one string.
      rowKey={(r) => [r.snapshotId, r.projectId ?? '', r.costCenter ?? '', r.account ?? '', r.fiscalYear ?? ''].join('\u0000')}
    />
    <SnapshotBlock<ErpAgingSnapshotRow>
      title="AP aging"
      emptyLabel="No AP aging snapshot yet"
      rows={apAging}
      pending={apAgingPending}
      isError={apAgingError}
      onRetry={onRetryApAging}
      columns={AGING_COLUMNS}
      rowKey={(r) => r.snapshotId + (r.party ?? '')}
      reportVersion={apAging[0]?.reportVersion}
    />
    <SnapshotBlock<ErpAgingSnapshotRow>
      title="AR aging"
      emptyLabel="No AR aging snapshot yet"
      rows={arAging}
      pending={arAgingPending}
      isError={arAgingError}
      onRetry={onRetryArAging}
      columns={AGING_COLUMNS}
      rowKey={(r) => r.snapshotId + (r.party ?? '')}
      reportVersion={arAging[0]?.reportVersion}
    />
  </section>
);

AccountingSnapshotsSection.displayName = 'AccountingSnapshotsSection';
