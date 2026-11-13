import React, { useMemo } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, cn, DataTable, Icon, ListPage, ListState, SelectField, StatusPill, useUrlFilters, type Column } from '@/src/components/ui';
import { Menu } from '@/src/components/ui/menu';
import { menuItemClass, menuPopupClass, menuPopupOrigin } from '@/src/components/ui/menuStyles';
import { StockFilters, StockTabs } from '@/src/components/stock/StockTabs';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useAuth } from '@/src/auth/useAuth';
import { useStockDocuments, useStockKeepers } from '@/src/hooks/useStock';
import { formatDay } from '@/src/lib/format';
import { statusLabel } from '@/src/lib/status/statusMap';
import type { StockDocumentKind, StockDocumentListRow, StockDocumentStatus } from '@/src/lib/db/stockDocuments';

const KINDS: StockDocumentKind[] = ['receive', 'transfer', 'issue', 'return', 'adjustment', 'count'];
const STATUSES: StockDocumentStatus[] = ['Draft', 'Posted', 'Cancelled'];
const NEW_DOCUMENT_KINDS: StockDocumentKind[] = ['receive', 'transfer', 'issue', 'return', 'count', 'adjustment'];

/**
 * The register reads newest movement first; documents dated the same day read by number, highest
 * first (numbers count up), then by the order they were written so the order is total and stable.
 * The server pages on (created_at, id) — a hidden column — so the visible order is settled here.
 */
const compareDocuments = (a: StockDocumentListRow, b: StockDocumentListRow): number =>
  (b.occurred_on ?? '').localeCompare(a.occurred_on ?? '') ||
  (b.number ?? '').localeCompare(a.number ?? '', undefined, { numeric: true }) ||
  (b.created_at ?? '').localeCompare(a.created_at ?? '') ||
  b.id.localeCompare(a.id);

const StockDocuments: React.FC = () => {
  const { t } = useTranslation('stock');
  const { t: tStatus } = useTranslation('status');
  const navigate = useNavigate();
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  const me = useAuth().currentUser?.id;
  const keepers = useStockKeepers();
  const isKeeper = (keepers.data ?? []).some((keeper) => keeper.user_id === me);
  const canMove = may('create', 'stockDocument', { record: { isKeeper, viewOnly: realRole !== effectiveRole } });
  // R2: kind/status are URL-owned so Back/refresh (and a shared link) keep them; defaults stay
  // out of the URL (empty = all).
  const { values, setFilter } = useUrlFilters(['kind', 'status']);
  const kind = values.kind;
  const status = values.status;
  const setKind = (value: string) => setFilter('kind', value);
  const setStatus = (value: string) => setFilter('status', value);
  const q = useStockDocuments({ ...(kind ? { kind: kind as StockDocumentKind } : {}), ...(status ? { status: status as StockDocumentStatus } : {}) });
  const rows = useMemo(() => [...(q.data?.pages ?? []).flat()].sort(compareDocuments), [q.data]);
  const total = q.total;

  const columns: Column<StockDocumentListRow>[] = useMemo(() => [
    {
      key: 'number', header: t('documents.columns.number'), rowHeader: true,
      cell: (r) => (
        <div className="min-w-0">
          <Link to={`/stock/documents/${r.id}`} className="block truncate font-mono text-sm font-semibold hover:underline">{r.number}</Link>
          <span className="block truncate text-sm text-muted-foreground">{t(`kinds.${r.kind}`)}</span>
        </div>
      ),
      exportValue: (r) => r.number,
    },
    { key: 'status', header: t('documents.columns.status'), cell: (r) => <StatusPill record="stockDocument" state={r.status} />, exportValue: (r) => r.status },
    {
      key: 'warehouse', header: t('documents.columns.warehouse'),
      cell: (r) => <span className="text-sm">{r.warehouse?.code ?? ''}{r.to_warehouse ? ` → ${r.to_warehouse.code}` : ''}</span>,
      exportValue: (r) => r.warehouse?.code ?? '',
    },
    { key: 'project', header: t('documents.columns.project'), colClassName: 'hidden md:table-cell', cell: (r) => (r.project?.name ? <span className="text-sm">{r.project.name}</span> : null), exportValue: (r) => r.project?.name ?? '' },
    { key: 'date', header: t('documents.columns.date'), cell: (r) => <span className="tabular-nums">{formatDay(r.occurred_on)}</span>, exportValue: (r) => r.occurred_on },
    { key: 'by', header: t('documents.columns.by'), colClassName: 'hidden lg:table-cell', cell: (r) => <span className="text-sm">{r.author?.full_name ?? ''}</span>, exportValue: (r) => r.author?.full_name ?? '' },
  ], [t]);

  // A failed next page keeps the rows already read: that failure is reported under the table, not by
  // replacing the register with a page-level error.
  const state: 'loading' | 'empty' | 'error' | undefined =
    q.isError && !q.isFetchNextPageError ? 'error' : q.isPending ? 'loading' : rows.length === 0 ? 'empty' : undefined;
  const filtered = Boolean(kind || status);

  return (
    <ListPage
      title={t('documents.title')}
      count={total}
      primaryAction={canMove && (
        <Menu.Root modal={false}>
          <Menu.Trigger render={<Button variant="primary" />}>
            <Icon name="plus" />
            {t('documents.newDocument', 'New document')}
            <Icon name="chev" aria-hidden className="size-3.5 rotate-90" />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner side="bottom" align="end" sideOffset={4} collisionPadding={12} className="z-50">
              <Menu.Popup aria-label={t('documents.newDocument', 'New document')} className={cn(menuPopupClass, 'min-w-48')} style={menuPopupOrigin}>
                {NEW_DOCUMENT_KINDS.map((documentKind) => (
                  <Menu.Item
                    key={documentKind}
                    className={cn(menuItemClass, 'min-h-10')}
                    onClick={() => navigate(`/stock/new/${documentKind}`)}
                  >
                    {t(`kinds.${documentKind}`)}
                  </Menu.Item>
                ))}
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      )}
    >
      <StockTabs />
      <StockFilters>
          <SelectField label={t('documents.filters.kind')} hideLabel value={kind} onChange={setKind}
            options={KINDS.map((k) => ({ value: k, label: t(`kinds.${k}`) }))} placeholder={t('documents.filters.allKinds')} />
          <SelectField label={t('documents.filters.status')} hideLabel value={status} onChange={setStatus}
            options={STATUSES.map((s) => ({ value: s, label: statusLabel('stockDocument', s, tStatus) }))} placeholder={t('documents.filters.allStatuses')} />
      </StockFilters>
      {state === 'loading' && <div className="rounded-lg border border-border bg-card"><ListState variant="loading" rows={6} /></div>}
      {state === 'error' && <ListState variant="error" title={t('states.errorTitle')} sub={t('states.errorSub')} retryLabel={t('actions.retry')} onRetry={() => void q.refetch()} />}
      {state === 'empty' && (
        <ListState variant="empty" icon="folder" title={t(filtered ? 'documents.states.noMatch' : 'documents.states.empty')} sub={t(filtered ? 'documents.states.noMatchSub' : 'documents.states.emptySub')} />
      )}
      {state === undefined && (
        <>
          <DataTable<StockDocumentListRow> rows={rows} columns={columns} rowKey={(r) => r.id} tableId="stock-documents" accessibleName={t('documents.title')}
            onActivate={(r) => navigate(`/stock/documents/${r.id}`)}
            total={total}
            hasMore={Boolean(q.hasNextPage)}
            isLoadingMore={q.isFetchingNextPage}
            onLoadMore={() => void q.fetchNextPage()}
            loadMoreLabel={t('documents.loadMore')} />
          {q.isFetchNextPageError && (
            /* C1: a failed next page must not leave the register looking complete. */
            <div className="mt-3">
              <ListState
                variant="error"
                title={t('documents.loadMoreFailed', "Couldn't load more documents")}
                sub={t('states.errorSub')}
                retryLabel={t('actions.retry')}
                onRetry={() => void q.fetchNextPage()}
              />
            </div>
          )}
        </>
      )}
    </ListPage>
  );
};

export default StockDocuments;
