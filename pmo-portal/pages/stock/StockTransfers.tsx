import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, ListState, PageHeader } from '@/src/components/ui';
import { StockTabs } from '@/src/components/stock/StockTabs';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useIsTwoStep, useProofStatus, useStockTransfers } from '@/src/hooks/useStockTransfers';
import { useStockWarehouses } from '@/src/hooks/useStock';
import { formatDateTime } from '@/src/lib/format';
import type { StockTransfer } from '@/src/lib/repositories/stockTransfers';

const openShort = (t: StockTransfer): number => t.lines.filter((l) => l.qtyCounted !== null && l.qtyCounted !== l.qtySent && l.shortResolution === null).length;

/** Two-step transfers in three groups: in transit, short (an open shortfall), closed. A phone list of cards: the receiver is often on site. */
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
  const groups: { key: string; items: StockTransfer[] }[] = [
    { key: 'inTransit', items: rows.filter((r) => r.status === 'Sent') },
    { key: 'short', items: rows.filter((r) => r.status === 'Received') },
    { key: 'closed', items: rows.filter((r) => r.status === 'Closed' || r.status === 'Cancelled') },
  ];
  return (
    <div>
      <PageHeader title={t('transfers.title')} action={twoStep && realRole === effectiveRole ? <Link to="/stock/transfers/new"><Button variant="primary">{t('transfers.send')}</Button></Link> : undefined} />
      <StockTabs />
      {!twoStep ? <ListState variant="empty" icon="folder" title={t('transfers.off.title')} sub={t('transfers.off.sub')} />
        : transfers.isPending ? <ListState variant="loading" rows={4} />
        : transfers.isError ? <ListState variant="error" title={t('states.errorTitle')} sub={t('states.errorSub')} retryLabel={t('actions.retry')} onRetry={() => void transfers.refetch()} />
        : rows.length === 0 ? <ListState variant="empty" icon="folder" title={t('transfers.empty.title')} sub={t('transfers.empty.sub')} />
        : <div className="space-y-6">{groups.filter((g) => g.items.length > 0).map((g) => (
          <section key={g.key} aria-label={t(`transfers.groups.${g.key}`)} className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground">{t(`transfers.groups.${g.key}`)} ({g.items.length})</h2>
            <ul className="space-y-2">{g.items.map((r) => (
              <li key={r.id}>
                <Link to={`/stock/transfers/${r.id}`} className="block rounded-lg border border-border bg-card p-3 hover:bg-muted/40">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{r.number}</span>
                    <span className="text-sm text-muted-foreground">{t(`transfers.status.${r.status}`)}</span>
                  </div>
                  <div className="text-sm">{nameOf(r.fromWarehouseId)} → {nameOf(r.toWarehouseId)}</div>
                  <div className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
                    <span>{formatDateTime(new Date(r.sentAt))}</span>
                    {openShort(r) > 0 && <span>{t('transfers.shortOpen', { count: openShort(r) })}</span>}
                    {outstanding.has(r.id) && <span>{t('proof.outstanding')}</span>}
                  </div>
                </Link>
              </li>
            ))}</ul>
          </section>
        ))}</div>}
    </div>
  );
};
export default StockTransfers;
