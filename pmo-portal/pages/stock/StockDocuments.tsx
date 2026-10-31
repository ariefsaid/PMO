import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, DataTable, ListPage, ListState, SelectField, StatusPill, type Column } from '@/src/components/ui';
import { StockTabs } from '@/src/components/stock/StockTabs';
import { useStockDocuments } from '@/src/hooks/useStock';
import { statusVariant } from '@/src/components/stock/stockStatus';
import type { StockDocumentKind, StockDocumentListRow, StockDocumentStatus } from '@/src/lib/db/stockDocuments';

const KINDS: StockDocumentKind[] = ['receive', 'transfer', 'issue', 'return', 'adjustment', 'count'];
const STATUSES: StockDocumentStatus[] = ['Draft', 'Posted', 'Cancelled'];

const StockDocuments: React.FC = () => {
  const { t } = useTranslation('stock');
  const navigate = useNavigate();
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const q = useStockDocuments({ ...(kind ? { kind: kind as StockDocumentKind } : {}), ...(status ? { status: status as StockDocumentStatus } : {}) });
  const rows = useMemo(() => (q.data?.pages ?? []).flat(), [q.data]);

  const columns: Column<StockDocumentListRow>[] = useMemo(() => [
    {
      key: 'number', header: t('documents.columns.number'), rowHeader: true,
      cell: (r) => (
        <div className="min-w-0">
          <Link to={`/stock/documents/${r.id}`} className="block truncate font-mono text-sm font-semibold hover:underline">{r.number}</Link>
          <span className="block truncate text-xs text-muted-foreground">{t(`kinds.${r.kind}`)}</span>
        </div>
      ),
      exportValue: (r) => r.number,
    },
    { key: 'status', header: t('documents.columns.status'), cell: (r) => <StatusPill variant={statusVariant(r.status)}>{t(`documents.status.${r.status}`)}</StatusPill>, exportValue: (r) => r.status },
    {
      key: 'warehouse', header: t('documents.columns.warehouse'),
      cell: (r) => <span className="text-sm">{r.warehouse?.code ?? ''}{r.to_warehouse ? ` → ${r.to_warehouse.code}` : ''}</span>,
      exportValue: (r) => r.warehouse?.code ?? '',
    },
    { key: 'project', header: t('documents.columns.project'), colClassName: 'hidden md:table-cell', cell: (r) => <span className="text-sm">{r.project?.name ?? '–'}</span>, exportValue: (r) => r.project?.name ?? '' },
    { key: 'date', header: t('documents.columns.date'), cell: (r) => <span className="tabular-nums">{r.occurred_on}</span>, exportValue: (r) => r.occurred_on },
    { key: 'by', header: t('documents.columns.by'), colClassName: 'hidden lg:table-cell', cell: (r) => <span className="text-sm">{r.author?.full_name ?? ''}</span>, exportValue: (r) => r.author?.full_name ?? '' },
  ], [t]);

  const state: 'loading' | 'empty' | 'error' | undefined = q.isError ? 'error' : q.isPending ? 'loading' : rows.length === 0 ? 'empty' : undefined;
  const filtered = Boolean(kind || status);

  return (
    <ListPage
      title={t('documents.title')}
      description={t('documents.description')}
      filters={
        <div className="flex flex-wrap items-end gap-3">
          <SelectField label={t('documents.filters.kind')} hideLabel value={kind} onChange={setKind}
            options={KINDS.map((k) => ({ value: k, label: t(`kinds.${k}`) }))} placeholder={t('documents.filters.allKinds')} />
          <SelectField label={t('documents.filters.status')} hideLabel value={status} onChange={setStatus}
            options={STATUSES.map((s) => ({ value: s, label: t(`documents.status.${s}`) }))} placeholder={t('documents.filters.allStatuses')} />
        </div>
      }
    >
      <StockTabs />
      {state === 'loading' && <div className="rounded-lg border border-border bg-card"><ListState variant="loading" rows={6} /></div>}
      {state === 'error' && <ListState variant="error" title={t('states.errorTitle')} sub={t('states.errorSub')} retryLabel={t('actions.retry')} onRetry={() => void q.refetch()} />}
      {state === 'empty' && (
        <ListState variant="empty" icon="folder" title={t(filtered ? 'documents.states.noMatch' : 'documents.states.empty')} sub={t(filtered ? 'documents.states.noMatchSub' : 'documents.states.emptySub')} />
      )}
      {state === undefined && (
        <>
          <DataTable<StockDocumentListRow> rows={rows} columns={columns} rowKey={(r) => r.id} tableId="stock-documents" accessibleName={t('documents.title')}
            onActivate={(r) => navigate(`/stock/documents/${r.id}`)} />
          {q.hasNextPage && (
            <div className="mt-3 flex justify-center">
              <Button variant="outline" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>{t('documents.loadMore')}</Button>
            </div>
          )}
        </>
      )}
    </ListPage>
  );
};

export default StockDocuments;
