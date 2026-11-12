import React from 'react';
import { useTranslation } from 'react-i18next';
import { ListState, StatusPill } from '@/src/components/ui';
import { useWorkOrderCostVariations } from '@/src/hooks/useSubcontract';
import { formatCurrency } from '@/src/lib/format';

/** Read-only client work-order view of cost variations linked from subcontract POs. */
export const WorkOrderCostVariations: React.FC<{ workOrderId: string; currency: string }> = ({ workOrderId, currency }) => {
  const { t } = useTranslation('procurement');
  const query = useWorkOrderCostVariations(workOrderId);

  return (
    <section aria-label={t('subcontract.variations.workOrderHeading', 'Cost variations')} className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-medium text-muted-foreground">{t('subcontract.variations.workOrderHeading', 'Cost variations')}</span>
      {query.isPending ? <ListState variant="loading" rows={1} />
        : query.isError ? <ListState variant="error" title={t('subcontract.variations.workOrderLoadError', 'Could not load cost variations.')}
          onRetry={() => void query.refetch()} retryLabel={t('subcontract.lines.retry', 'Retry')} />
          : (query.data ?? []).length === 0 ? <span className="text-muted-foreground">{t('subcontract.variations.workOrderEmpty', 'No linked cost variations')}</span>
            : <ul className="flex flex-wrap items-center gap-2" data-testid={`work-order-cost-variations-${workOrderId}`}>
              {(query.data ?? []).map((variation) => (
                <li key={variation.id} className="flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold">{variation.number}</span>
                  <span className="tabular-nums">{formatCurrency(Number(variation.amount), currency)}</span>
                  <StatusPill record="costVariation" state={variation.status} />
                </li>
              ))}
            </ul>}
    </section>
  );
};
