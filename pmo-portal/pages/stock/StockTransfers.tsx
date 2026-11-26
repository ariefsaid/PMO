import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, DataTable, ListState, PageHeader, StatusPill, type Column } from '@/src/components/ui';
import { getActiveLocale } from '@/src/lib/locale/activeLocale';
import { StockTabs } from '@/src/components/stock/StockTabs';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useIsTwoStep, useProofStatus, useStockTransfers } from '@/src/hooks/useStockTransfers';
import { useStockWarehouses } from '@/src/hooks/useStock';
import { formatCalendarDayInTimeZone, formatDay, formatInstantTime } from '@/src/lib/format';
import type { StockTransfer } from '@/src/lib/repositories/stockTransfers';

const openShort = (t: StockTransfer): number => t.lines.filter((l) => l.qtyCounted !== null && l.qtyCounted !== l.qtySent && l.shortResolution === null).length;

/** Two-step transfers in one table grouped in transit, short (an open shortfall), closed; cards on a phone, where the receiver often is. */
const StockTransfers: React.FC = () => {
  const { t } = useTranslation('stock');
  const twoStep = useIsTwoStep();
  const transfers = useStockTransfers(undefined, twoStep);
  const proof = useProofStatus('outstanding');
  const warehouses = useStockWarehouses(true);
  const { realRole, effectiveRole } = useEffectiveRole();
  const nameOf = (id: string) => (warehouses.data ?? []).find((w) => w.id === id)?.name ?? '';
  const outstanding = new Set((proof.data ?? []).map((p) => p.movementId));
  const rows = transfers.data ?? [];
  const groupOf = (r: StockTransfer) => r.status === 'Sent' ? 'inTransit' : r.status === 'Received' ? 'short' : 'closed';
  const groups: { key: string; items: StockTransfer[] }[] = [
    { key: 'inTransit', items: rows.filter((r) => r.status === 'Sent') },
    { key: 'short', items: rows.filter((r) => r.status === 'Received') },
    { key: 'closed', items: rows.filter((r) => r.status === 'Closed' || r.status === 'Cancelled') },
  ];
  const columns: Column<StockTransfer>[] = [
    { key: 'number', header: t('transfers.col.transfer'), kind: 'primary', size: 200, cell: (r) => r.number },
    { key: 'from', header: t('form.fromWarehouse'), size: 200, cell: (r) => nameOf(r.fromWarehouseId) },
    { key: 'to', header: t('form.toWarehouse'), size: 200, cell: (r) => nameOf(r.toWarehouseId) },
    { key: 'sent', header: t('transfers.facts.sent'), size: 140, cell: (r) => <span className="whitespace-nowrap tabular-nums">{formatDay(formatCalendarDayInTimeZone(new Date(r.sentAt), getActiveLocale().timezone))} {formatInstantTime(r.sentAt)}</span> },
    { key: 'status', header: t('transfers.col.status'), kind: 'status', size: 200, cell: (r) => <StatusPill variant={r.status === 'Closed' ? 'won' : r.status === 'Received' ? 'warn' : 'neutral'}>{t(`transfers.status.${r.status}`)}</StatusPill> },
    { key: 'open', header: t('transfers.col.open'), size: 200, cell: (r) => (openShort(r) > 0 || outstanding.has(r.id)) ? <span className="flex flex-col">{openShort(r) > 0 && <span>{t('transfers.shortOpen', { count: openShort(r) })}</span>}{outstanding.has(r.id) && <span>{t('proof.outstanding')}</span>}</span> : null },
  ];
  return (
    <div>
      <PageHeader title={t('transfers.title')} action={twoStep && realRole === effectiveRole ? <Link to="/stock/transfers/new"><Button variant="primary">{t('transfers.send')}</Button></Link> : undefined} />
      <StockTabs />
      {!twoStep ? <ListState variant="empty" icon="folder" title={t('transfers.off.title')} sub={t('transfers.off.sub')} />
        : transfers.isPending ? <ListState variant="loading" rows={4} />
        : transfers.isError ? <ListState variant="error" title={t('states.errorTitle')} sub={t('states.errorSub')} retryLabel={t('actions.retry')} onRetry={() => void transfers.refetch()} />
        : rows.length === 0 ? <ListState variant="empty" icon="folder" title={t('transfers.empty.title')} sub={t('transfers.empty.sub')} />
        : <DataTable<StockTransfer> rows={groups.flatMap((g) => g.items)} columns={columns} rowKey={(r) => r.id} tableId="stock-transfers" accessibleName={t('transfers.title')}
            rowHref={(r) => `/stock/transfers/${r.id}`} rowLabel={(r) => r.number} cardValuesEnd
            groupBy={(r) => groupOf(r)} groupHeaderSpan groupOrder={['inTransit', 'short', 'closed']} groupLabel={(key) => <>{t(`transfers.groups.${key}`)}<span className="ml-2 font-normal text-muted-foreground">{groups.find((g) => g.key === key)?.items.length}</span></>} />}
    </div>
  );
};
export default StockTransfers;
