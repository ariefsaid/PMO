import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Card, CardHead, CardPad } from '@/src/components/ui/Card';
import { ListState } from '@/src/components/ui/ListState';
import { StatusPill } from '@/src/components/ui/StatusPill';
import { useOpenWorkOrdersForHome } from '@/src/hooks/useWorkOrders';
import { useTerms } from '@/src/lib/i18n/terms';

/**
 * The home tile for work orders: the reader's open work orders with their status, and the way into the whole list.
 * The title is the terminology dictionary's term for a work order, the same word as the menu and the page.
 */
export const WorkOrdersTile: React.FC = () => {
  const { t } = useTranslation('workOrders');
  const terms = useTerms();
  const list = useOpenWorkOrdersForHome();
  const open = (list.data ?? []).filter((row) => row.status === 'Draft' || row.status === 'Issued');
  return (
    <Card data-testid="work-orders-tile">
      <CardHead level={2}>{terms.clientWorkOrder}</CardHead>
      <CardPad className="space-y-2">
        {list.isPending ? <ListState variant="loading" rows={2} />
          : list.isError ? <ListState variant="error" title={t('all.error', "Couldn't load your work orders")} onRetry={() => void list.refetch()} quiet />
            : open.length === 0 ? <p className="text-control text-muted-foreground">{t('all.tileEmpty', 'No open work orders')}</p>
              : (
                <ul className="divide-y divide-border">
                  {open.map((row) => (
                    <li key={row.id}>
                      <Link to={`/work-orders/${row.id}`} className="flex min-h-11 items-center justify-between gap-2 py-1.5 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                        <span className="min-w-0 truncate">{[row.wo_number, row.title].filter(Boolean).join(' · ')}</span>
                        <StatusPill record="workOrder" state={row.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
        <Link to="/work-orders" className="touch-target inline-flex items-center text-control font-medium text-primary-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
          {t('all.seeAll', 'See all')}
        </Link>
      </CardPad>
    </Card>
  );
};
