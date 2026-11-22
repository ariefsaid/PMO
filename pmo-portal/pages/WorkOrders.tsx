import React, { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ListState, PageHeader, SearchMini, StatusPill } from '@/src/components/ui';
import { useAllWorkOrders } from '@/src/hooks/useWorkOrders';
import { useTerms } from '@/src/lib/i18n/terms';
import { statusLabel, statusVariantOf } from '@/src/lib/status/statusMap';
import { formatDate } from '@/src/lib/format';

/**
 * Work orders — the front door (walk fix). Every work order the reader may see, across projects, with its status; a row opens
 * the work order. The page title is the terminology dictionary's term, so the menu, this page and the records say one name.
 * Reads are RLS-scoped and carry no money.
 */
const WorkOrders: React.FC = () => {
  const { t } = useTranslation('workOrders');
  const { t: ts } = useTranslation();
  const terms = useTerms();
  const list = useAllWorkOrders();
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = list.data ?? [];
    return q ? all.filter((r) => [r.wo_number, r.title, r.project_name].some((v) => v?.toLowerCase().includes(q))) : all;
  }, [list.data, query]);

  return (
    <div className="space-y-4">
      <PageHeader title={terms.clientWorkOrder} count={list.data?.length} />
      <SearchMini value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('all.search', 'Search by number, title or project')} />
      {list.isPending ? <ListState variant="loading" rows={5} />
        : list.isError ? <ListState variant="error" title={t('all.error', "Couldn't load your work orders")} onRetry={() => void list.refetch()} />
        : rows.length === 0 ? <ListState variant="empty" title={query ? t('all.noMatch', 'No work order matches your search') : t('all.empty', 'You have no work orders yet')} />
        : (
          <ul className="divide-y divide-border rounded-md border border-border bg-card" data-testid="work-order-list">
            {rows.map((row) => (
              <li key={row.id}>
                <Link to={`/work-orders/${row.id}`} className="flex min-h-11 flex-wrap items-center justify-between gap-2 px-3 py-2 hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{[row.wo_number, row.title].filter(Boolean).join(' · ')}</span>
                    <span className="block truncate text-muted-foreground">
                      {row.project_name}
                      {row.end_date ? ` · ${t('all.until', 'until {{date}}', { date: formatDate(row.end_date) })}` : ''}
                    </span>
                  </span>
                  <StatusPill variant={statusVariantOf('workOrder', row.status)}>{statusLabel('workOrder', row.status, ts)}</StatusPill>
                </Link>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
};

export default WorkOrders;
