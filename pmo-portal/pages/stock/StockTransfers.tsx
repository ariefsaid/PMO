import React from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, DataTable, ListState, PageHeader, StatusPill, type Column } from '@/src/components/ui';
import { StockTabs } from '@/src/components/stock/StockTabs';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useIsTwoStep, useProofStatus, useStockTransfers } from '@/src/hooks/useStockTransfers';
import { useStockWarehouses } from '@/src/hooks/useStock';
import { formatDay, formatInstantTime } from '@/src/lib/format';
import type { StockTransfer } from '@/src/lib/repositories/stockTransfers';
import { TRANSFER_VARIANT, openShortfalls } from './transferStatus';

/** The groups in the order a person acts on them: a shortfall waits for a decision, then what is still on the road. */
const GROUPS = ['short', 'inTransit', 'closed'] as const;
const groupOf = (r: StockTransfer): (typeof GROUPS)[number] =>
  r.status === 'Received' ? 'short' : r.status === 'Sent' ? 'inTransit' : 'closed';

/**
 * Two-step transfers as ONE table in three groups (short, in transit, closed): a row per transfer with its
 * route, when it left, how many lines and its state. The open shortfalls and missing proof sit under the
 * number, inside the row's link. On a phone each row is a card: the receiver is often on site.
 */
const StockTransfers: React.FC = () => {
  const { t } = useTranslation('stock');
  const navigate = useNavigate();
  const twoStep = useIsTwoStep();
  const transfers = useStockTransfers(undefined, twoStep);
  const proof = useProofStatus('outstanding');
  const warehouses = useStockWarehouses(true);
  const { realRole, effectiveRole } = useEffectiveRole();
  const nameOf = (id: string) => (warehouses.data ?? []).find((w) => w.id === id)?.name ?? '';
  const outstanding = new Set((proof.data ?? []).map((p) => p.movementId));
  const rows = transfers.data ?? [];
  const flags = (r: StockTransfer) => {
    const short = openShortfalls(r).length;
    const parts = [
      ...(short > 0 ? [t('transfers.shortOpen', { count: short })] : []),
      ...(outstanding.has(r.id) ? [t('proof.outstanding')] : []),
    ];
    return parts.length > 0 ? parts.join(' · ') : null;
  };
  const columns: Column<StockTransfer>[] = [
    { key: 'number', header: t('transfers.columns.transfer'), kind: 'primary', size: 220, cell: (r) => r.number, primaryTitle: (r) => r.number, secondaryCell: flags },
    { key: 'from', header: t('transfers.print.from'), cell: (r) => nameOf(r.fromWarehouseId) },
    { key: 'to', header: t('transfers.print.to'), cell: (r) => nameOf(r.toWarehouseId) },
    { key: 'lines', header: t('transfers.lines'), align: 'num', size: 88, cell: (r) => <span className="tabular-nums">{r.lines.length}</span> },
    { key: 'sent', header: t('transfers.columns.sent'), kind: 'date', size: 140, cell: (r) => <span className="whitespace-nowrap tabular-nums">{formatDay(r.sentAt)}, {formatInstantTime(r.sentAt)}</span> },
    { key: 'status', header: t('receiving.status'), kind: 'status', size: 216, cell: (r) => <StatusPill variant={TRANSFER_VARIANT[r.status]}>{t(`transfers.status.${r.status}`)}</StatusPill> },
  ];
  return (
    <div>
      <PageHeader title={t('transfers.title')} action={twoStep && realRole === effectiveRole ? <Link to="/stock/transfers/new"><Button variant="primary">{t('transfers.send')}</Button></Link> : undefined} />
      {twoStep && <StockTabs />}
      {!twoStep ? <ListState variant="empty" icon="folder" title={t('transfers.off.title')} sub={t('transfers.off.sub')} />
        : transfers.isPending ? <ListState variant="loading" rows={4} />
        : transfers.isError ? <ListState variant="error" title={t('states.errorTitle')} sub={t('states.errorSub')} retryLabel={t('actions.retry')} onRetry={() => void transfers.refetch()} />
        : rows.length === 0 ? <ListState variant="empty" icon="folder" title={t('transfers.empty.title')} sub={t('transfers.empty.sub')} />
        : <DataTable<StockTransfer>
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          onActivate={(r) => navigate(`/stock/transfers/${r.id}`)}
          rowHref={(r) => `/stock/transfers/${r.id}`}
          rowLabel={(r) => r.number}
          tableId="stock-transfers"
          accessibleName={t('transfers.title')}
          groupBy={groupOf}
          groupOrder={GROUPS.filter((g) => rows.some((r) => groupOf(r) === g))}
          groupLabel={(key) => `${t(`transfers.groups.${key}`)} (${rows.filter((r) => groupOf(r) === key).length})`}
          groupHeaderSpan
        />}
    </div>
  );
};
export default StockTransfers;
