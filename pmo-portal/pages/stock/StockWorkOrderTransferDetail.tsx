import React from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ListState, PageHeader } from '@/src/components/ui';
import { useWoTransfer, useWoTransfersEnabled } from '@/src/hooks/useStockWorkOrderTransfer';
import { useWorkOrder } from '@/src/hooks/useWorkOrderRecord';
import { formatDay } from '@/src/lib/format';

const woLabel = (w: { wo_number?: string | null; title?: string | null } | null | undefined, fallback: string): string => [w?.wo_number, w?.title].filter(Boolean).join(' - ') || fallback;

/** One work-order transfer: its two halves and both work orders (#2691). */
const StockWorkOrderTransferDetail: React.FC = () => {
  const { t } = useTranslation('stock');
  const { transferId } = useParams();
  const enabled = useWoTransfersEnabled();
  const q = useWoTransfer(transferId);
  const from = useWorkOrder(q.data?.fromWorkOrderId);
  const to = useWorkOrder(q.data?.toWorkOrderId);
  if (!enabled) return <div className="p-4"><ListState variant="empty" icon="folder" title={t('workOrderTransfer.off.title')} sub={t('workOrderTransfer.off.sub')} /></div>;
  if (q.isPending) return <div className="p-4"><ListState variant="loading" rows={4} /></div>;
  if (q.isError) return <div className="p-4"><ListState variant="error" title={t('states.errorTitle')} sub={t('states.errorSub')} retryLabel={t('actions.retry')} onRetry={() => void q.refetch()} /></div>;
  const x = q.data;
  if (!x) return <div className="p-4"><ListState variant="empty" icon="folder" title={t('workOrderTransfer.notFound')} /></div>;
  const ret = x.halves.find((h) => h.kind === 'return');
  const iss = x.halves.find((h) => h.kind === 'issue');
  return (
    <div>
      <PageHeader title={`${t('workOrderTransfer.detailTitle')} ${x.number}`} />
      <dl className="max-w-3xl space-y-3">
        <div><dt className="text-sm text-muted-foreground">{t('workOrderTransfer.from')}</dt><dd><Link className="font-medium hover:underline" to={`/work-orders/${x.fromWorkOrderId}`}>{woLabel(from.data, x.fromWorkOrderId)}</Link></dd></div>
        <div><dt className="text-sm text-muted-foreground">{t('workOrderTransfer.to')}</dt><dd><Link className="font-medium hover:underline" to={`/work-orders/${x.toWorkOrderId}`}>{woLabel(to.data, x.toWorkOrderId)}</Link></dd></div>
        <div><dt className="text-sm text-muted-foreground">{t('documents.columns.date')}</dt><dd>{formatDay(x.occurredOn)}</dd></div>
        {x.note && <div><dt className="text-sm text-muted-foreground">{t('form.note')}</dt><dd>{x.note}</dd></div>}
      </dl>
      <section aria-label={t('workOrderTransfer.halves')} className="mt-4 max-w-3xl space-y-2">
        <h2 className="text-base font-semibold">{t('workOrderTransfer.halves')}</h2>
        <ul className="space-y-2">
          {ret && <li className="rounded-lg border border-border p-3"><Link className="font-medium hover:underline" to={`/stock/documents/${ret.id}`}>{ret.number}</Link><span className="block text-sm text-muted-foreground">{t('workOrderTransfer.returnHalf')}</span></li>}
          {iss && <li className="rounded-lg border border-border p-3"><Link className="font-medium hover:underline" to={`/stock/documents/${iss.id}`}>{iss.number}</Link><span className="block text-sm text-muted-foreground">{t('workOrderTransfer.issueHalf')}</span></li>}
        </ul>
      </section>
    </div>
  );
};
export default StockWorkOrderTransferDetail;
