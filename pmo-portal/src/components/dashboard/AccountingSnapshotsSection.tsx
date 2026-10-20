import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Card, CardHead } from '@/src/components/ui/Card';
import { DataTable, type Column } from '@/src/components/ui/DataTable';
import { ListState } from '@/src/components/ui/ListState';
import { AccountingSnapshotProvenance } from '@/src/components/AccountingSnapshotProvenance';
import { formatCurrency } from '@/src/lib/format';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
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
  showActuals?: boolean;
  showApAging?: boolean;
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
  customerLinks?: ReadonlyMap<string, string>;
  actualProjectNames?: ReadonlyMap<string, string>;
}

const agingValue = (value: number | null, currency: string | null, unavailable: string) => {
  if (value === null || !currency || !/^[A-Z]{3}$/.test(currency)) {
    return <span className="text-muted-foreground">{unavailable}</span>;
  }
  return <span>{formatCurrency(value, currency)}</span>;
};

const agingRowKey = (row: ErpAgingSnapshotRow) => [
  row.snapshotId,
  row.partyType ?? '',
  row.party ?? '',
  row.currency ?? '',
  row.reportDate ?? '',
  row.ageingBasedOn ?? '',
  row.asOf,
  row.sourceReport ?? '',
  row.reportVersion ?? '',
  JSON.stringify(row.rangeLabels ?? {}),
].join('\u0000');

const agingColumns = (
  labels: { party: string; current: string; total: string; unavailable: string; reportDate: string; ageingBasis: string; ranges: string },
  customerLinks?: ReadonlyMap<string, string>,
): Column<ErpAgingSnapshotRow>[] => [
  {
    key: 'party',
    header: labels.party,
    cell: (r) => {
      const companyId = r.partyType === 'Customer' && r.party ? customerLinks?.get(r.party) : undefined;
      const ranges = r.rangeLabels && Object.keys(r.rangeLabels).length > 0
        ? Object.entries(r.rangeLabels).map(([key, value]) => `${key}: ${value}`).join(', ')
        : labels.unavailable;
      return (
        <div className="whitespace-normal">
          {companyId && r.party ? (
            <Link className="font-medium text-primary-text underline-offset-2 hover:underline" to={`/companies/${encodeURIComponent(companyId)}#collections`}>
              {r.party}
            </Link>
          ) : (
            <span className="font-medium">{r.party ?? labels.unavailable}</span>
          )}
          <dl className="mt-1 flex flex-col gap-0.5 text-[11px] text-muted-foreground">
            <div><dt className="sr-only">{labels.reportDate}</dt><dd>{labels.reportDate}: {r.reportDate ?? labels.unavailable}</dd></div>
            <div><dt className="sr-only">{labels.ageingBasis}</dt><dd>{labels.ageingBasis}: {r.ageingBasedOn ?? labels.unavailable}</dd></div>
            <div><dt className="sr-only">{labels.ranges}</dt><dd>{labels.ranges}: {ranges}</dd></div>
          </dl>
        </div>
      );
    },
  },
  {
    key: 'current',
    header: labels.current,
    align: 'num',
    cell: (r) => agingValue(r.current, r.currency, labels.unavailable),
  },
  {
    key: 'b0_30',
    header: '0–30',
    align: 'num',
    cell: (r) => agingValue(r.bucket0to30, r.currency, labels.unavailable),
  },
  {
    key: 'b31_60',
    header: '31–60',
    align: 'num',
    cell: (r) => agingValue(r.bucket31to60, r.currency, labels.unavailable),
  },
  {
    key: 'b61_90',
    header: '61–90',
    align: 'num',
    cell: (r) => agingValue(r.bucket61to90, r.currency, labels.unavailable),
  },
  {
    key: 'b90plus',
    header: '90+',
    align: 'num',
    cell: (r) => agingValue(r.bucketOver90, r.currency, labels.unavailable),
  },
  {
    key: 'total',
    header: labels.total,
    align: 'num',
    cell: (r) => <span className="font-semibold">{agingValue(r.totalOutstanding, r.currency, labels.unavailable)}</span>,
  },
];

const actualsColumns = (orgCurrency: string, t: (key: string, fallback: string) => string, projectNames?: ReadonlyMap<string, string>): Column<ErpActualsSnapshotRow>[] => [
  {
    key: 'project',
    header: t('dashboard:finance.project', 'Project'),
    cell: (r) => r.projectId ? (
      <Link className="font-medium text-primary-text underline-offset-2 hover:underline" to={`/projects/${encodeURIComponent(r.projectId)}`}>
        {projectNames?.get(r.projectId) ?? <span title={t('dashboard:finance.projectUnavailableReason', 'Project name is unavailable.')}>—<span className="sr-only"> {t('dashboard:finance.projectUnavailableReason', 'Project name is unavailable.')}</span></span>}
      </Link>
    ) : <span className="text-muted-foreground">{t('dashboard:finance.unattributed', 'Not attributed to a project')}</span>,
  },
  {
    key: 'account',
    header: t('dashboard:finance.account', 'Account'),
    cell: (r) => <span className="font-medium">{r.account ?? '—'}</span>,
  },
  {
    key: 'costCenter',
    header: t('dashboard:finance.costCenter', 'Cost center'),
    cell: (r) => <span className="text-muted-foreground">{r.costCenter ?? '—'}</span>,
  },
  {
    key: 'fiscalYear',
    header: t('dashboard:finance.fiscalYear', 'Fiscal year'),
    cell: (r) => <span className="text-muted-foreground">{r.fiscalYear ?? '—'}</span>,
  },
  {
    key: 'net',
    header: t('dashboard:finance.net', 'Net'),
    align: 'num',
    cell: (r) => r.net === null || !Number.isFinite(r.net) ? (
      <span className="text-muted-foreground" title={t('dashboard:finance.netUnavailableReason', 'The source snapshot did not supply a Net value.')}>
        —<span className="sr-only"> {t('dashboard:finance.netUnavailableReason', 'The source snapshot did not supply a Net value.')}</span>
      </span>
    ) : <span className="font-semibold">{formatCurrency(r.net, orgCurrency)}</span>,
  },
];

/** One snapshot subsection: title, provenance strip (from the first row — snapshot-replace keeps
 *  every own-org row on one shared `snapshot_id`/`as_of`), and either the empty/loading/error state
 *  or the populated table. */
function SnapshotBlock<Row extends { asOf: string; sourceReport: string | null }>({
  title,
  emptyLabel,
  emptyDescription,
  rows,
  pending,
  isError,
  onRetry,
  columns,
  rowKey,
  reportVersion,
  tableId,
  errorLabel,
}: {
  title: string;
  emptyLabel: string;
  emptyDescription: string;
  rows: Row[];
  pending?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  columns: Column<Row>[];
  rowKey: (r: Row) => string;
  reportVersion?: string | null;
  /** Saved-width identity: blocks sharing a column shape may share an id; different shapes must not. */
  tableId: string;
  errorLabel: string;
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
          <ListState variant="error" title={errorLabel} onRetry={onRetry} />
        ) : pending ? (
          <ListState variant="loading" rows={3} />
        ) : rows.length === 0 ? (
          <ListState variant="empty" icon="doc" title={emptyLabel} sub={emptyDescription} />
        ) : (
          <DataTable<Row> rows={rows} columns={columns} rowKey={rowKey} className="rounded-t-none border-t-0" tableId={tableId} />
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
  customerLinks,
  actualProjectNames,
  showActuals = true,
  showApAging = true,
}) => {
  const { t } = useTranslation('dashboard');
  // Actuals rows carry no currency field and are org-denominated. Aging rows must keep the source
  // currency explicit; a missing or malformed currency cannot inherit the org's currency.
  const orgCurrency = useOrgCurrency();
  const unavailable = t('dashboard.uxs36Unavailable', 'Unavailable');
  const reportDateLabel = t('dashboard.uxs36ReportDate', 'Report date');
  const ageingBasisLabel = t('dashboard.uxs36AgeingBasis', 'Ageing basis');
  const rangeLabelsLabel = t('dashboard.uxs36ErpRanges', 'ERP ranges');
  const agingLabels = {
    party: t('dashboard:finance.party', 'Party'), current: t('dashboard:finance.current', 'Current'),
    total: t('dashboard:finance.totalOutstanding', 'Total outstanding'), unavailable,
    reportDate: reportDateLabel, ageingBasis: ageingBasisLabel, ranges: rangeLabelsLabel,
  };
  return (
  <section aria-label={t('dashboard.accountingSnapshots', 'Accounting snapshots')} className="flex flex-col gap-4">
    {showActuals && (
    <SnapshotBlock<ErpActualsSnapshotRow>
      title={t('dashboard:finance.actualsTitle', 'Actuals (ERP ledger)')}
      errorLabel={t('dashboard:finance.actualsError', "Couldn't load actuals")}
      emptyLabel={t('dashboard.actualsSnapshotEmpty', 'No actuals snapshot yet')}
      emptyDescription={`${t('dashboard.snapshots.unavailable', 'No accounting snapshot has been synced yet.')} ${t('dashboard.snapshots.guidance', 'Ask your administrator to sync accounting data.')}`}
      rows={actuals}
      pending={actualsPending}
      isError={actualsError}
      onRetry={onRetryActuals}
      tableId="components-dashboard-accountingsnapshotssection-actuals-table"
      columns={actualsColumns(orgCurrency, t, actualProjectNames)}
      // ⚑ Audit round 11 (NEW-2): the key must carry the WHOLE grain. `erp_actuals_snapshot` is keyed
      // by (project, cost_centre, account, fiscal_year); this omitted project and fiscal year, so two
      // projects — or a project and the UNATTRIBUTED bucket — on one account+FY collided into one React
      // key while rendering as indistinguishable money rows (no Project column exists). `\u0000` as the
      // separator so concatenation cannot alias two different tuples into one string.
      rowKey={(r) => [r.snapshotId, r.projectId ?? '', r.costCenter ?? '', r.account ?? '', r.fiscalYear ?? ''].join('\u0000')}
    />
    )}
    {showApAging && (
    <SnapshotBlock<ErpAgingSnapshotRow>
      title={t('dashboard:finance.apTitle', 'Vendor payables (AP)')}
      errorLabel={t('dashboard:finance.apError', "Couldn't load vendor payables")}
      emptyLabel={t('dashboard.agingSnapshotEmpty', 'No aging data to show yet.')}
      emptyDescription={t('dashboard.snapshots.guidance', 'Ask your administrator to sync accounting data.')}
      rows={apAging}
      pending={apAgingPending}
      isError={apAgingError}
      onRetry={onRetryApAging}
      tableId="components-dashboard-accountingsnapshotssection-aging-table"
      columns={agingColumns(agingLabels)}
      rowKey={agingRowKey}
      reportVersion={apAging[0]?.reportVersion}
    />
    )}
    <SnapshotBlock<ErpAgingSnapshotRow>
      title={t('dashboard.uxs36CustomerCollectionsTitle', 'Customer collections (AR)')}
      errorLabel={t('dashboard:finance.arError', "Couldn't load customer receivables")}
      emptyLabel={t('dashboard.agingSnapshotEmpty', 'No aging data to show yet.')}
      emptyDescription={t('dashboard.snapshots.guidance', 'Ask your administrator to sync accounting data.')}
      rows={arAging}
      pending={arAgingPending}
      isError={arAgingError}
      onRetry={onRetryArAging}
      tableId="components-dashboard-accountingsnapshotssection-aging-table"
      columns={agingColumns(agingLabels, customerLinks)}
      rowKey={agingRowKey}
      reportVersion={arAging[0]?.reportVersion}
    />
  </section>
  );
};

AccountingSnapshotsSection.displayName = 'AccountingSnapshotsSection';
