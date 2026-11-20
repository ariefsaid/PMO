import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/src/components/ui/Button';
import { useBillingReconciliation } from '@/src/hooks/useBillingStages';
import { formatNumberExact, formatTableMoney } from '@/src/lib/format';

/** The server owns the quantities; unknown work-order progress remains unknown. */
export const BillingReconciliation: React.FC<{ projectId: string; workOrderId: string | null; currency: string }> = ({ projectId, workOrderId, currency }) => {
  const { t } = useTranslation('project');
  const query = useBillingReconciliation(projectId, workOrderId);
  const statusLabels = { unbilled: t('projectDetail.billing.reconciliation.statusUnbilled', 'Unbilled'), partly_billed: t('projectDetail.billing.reconciliation.statusPartly', 'Partly billed'), fully_billed: t('projectDetail.billing.reconciliation.statusFully', 'Fully billed'), surplus: t('projectDetail.billing.reconciliation.statusSurplus', 'Surplus') };
  const quantity = (value: number | null) => value === null ? t('projectDetail.billing.reconciliation.unknown', 'Unknown') : formatNumberExact(value);
  return <section className={workOrderId ? 'border-t border-border p-4' : 'panel-card min-w-0 p-[var(--panel-inset)]'} aria-label={t('projectDetail.billing.reconciliation.title', 'Billing reconciliation')}>
    <h3 className="text-group font-semibold">{t('projectDetail.billing.reconciliation.title', 'Billing reconciliation')}</h3>
    {query.isPending || query.isFetching ? <p className="mt-2 text-sm text-muted-foreground">{t('projectDetail.billing.reconciliation.loading', 'Loading reconciliation…')}</p>
      : query.isError ? <div role="alert" className="mt-2 text-sm"><p>{t('projectDetail.billing.reconciliation.error', 'Reconciliation could not be loaded.')}</p><Button variant="outline" size="sm" onClick={() => void query.refetch()}>{t('projectDetail.billing.stages.retry', 'Retry')}</Button></div>
      : !query.data?.length ? <p className="mt-2 text-sm text-muted-foreground">{t('projectDetail.billing.reconciliation.empty', 'No contract items to reconcile.')}</p>
      : <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-border">
        <th scope="col" className="p-2">{t('projectDetail.billing.reconciliation.item', 'Item')}</th>
        <th scope="col" className="p-2 text-right">{t('projectDetail.billing.reconciliation.scope', 'Scope')}</th>
        <th scope="col" className="p-2 text-right">{t('projectDetail.billing.reconciliation.progress', 'Progress')}</th>
        <th scope="col" className="p-2 text-right">{t('projectDetail.billing.reconciliation.measured', 'Measured')}</th>
        <th scope="col" className="p-2 text-right">{t('projectDetail.billing.reconciliation.billed', 'Billed')}</th>
        <th scope="col" className="p-2 text-right">{t('projectDetail.billing.reconciliation.amount', 'Billed amount')}</th>
        <th scope="col" className="p-2 text-right">{t('projectDetail.billing.reconciliation.unbilled', 'Unbilled')}</th>
        <th scope="col" className="p-2 text-right">{t('projectDetail.billing.reconciliation.surplus', 'Surplus')}</th>
        <th scope="col" className="p-2">{t('projectDetail.billing.reconciliation.status', 'Status')}</th>
      </tr></thead><tbody>{query.data.map(row => <tr key={row.boqItemId} className="border-b border-border">
        <th scope="row" className="p-2 font-medium"><span>{row.itemCode}</span> <span>{row.description}</span><span className="ml-1 text-muted-foreground">({row.unit})</span></th>
        <td className="p-2 text-right tabular-nums">{quantity(row.scopeQty)}</td><td className="p-2 text-right tabular-nums">{quantity(row.progressQty)}</td>
        <td className="p-2 text-right tabular-nums">{quantity(row.measuredQty)}</td><td className="p-2 text-right tabular-nums">{quantity(row.billedQty)}</td>
        <td className="p-2 text-right tabular-nums">{formatTableMoney(row.billedAmount, currency)}</td><td className="p-2 text-right tabular-nums">{quantity(row.unbilledQty)}</td><td className="p-2 text-right tabular-nums">{quantity(row.surplusQty)}</td><td className="p-2">{statusLabels[row.status]}</td>
      </tr>)}</tbody></table>{query.data.some(row => row.progressQty === null) && <p className="mt-2 text-sm text-muted-foreground">{t('projectDetail.billing.reconciliation.sharedProgress', 'Progress for shared items is recorded at project level.')}</p>}</div>}
  </section>;
};
