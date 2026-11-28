import React, { useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, DataTable, Icon, ListPage, ListState, SelectField, useUrlFilters, type Column } from '@/src/components/ui';
import { CanWrite } from '@/src/auth/usePermission';
import { useMaterialRequestHeaders, useMaterialRequests, useWaitingForMe } from '@/src/hooks/useMaterialRequests';
import type { MaterialRequestListRow, MaterialRequestStatus, WaitingStep } from '@/src/lib/repositories/materialRequests';
import { formatDay } from '@/src/lib/format';
import { RequestStatusPill, RequestWorkOrder } from './materialRequests/shared';
import { useLabels } from './materialRequests/useMaterialRequestText';

const STATUSES: MaterialRequestStatus[] = ['draft', 'pending', 'approved', 'fulfilled', 'rejected', 'cancelled'];

/** Material requests (#2524): every request the caller can see, and the steps waiting for them. Reads are RLS-scoped; the list is one bounded page. */
const MaterialRequestsPage: React.FC = () => {
  const { t } = useTranslation('materialRequests');
  const navigate = useNavigate();
  const labels = useLabels();
  const { values, setFilters } = useUrlFilters(['view', 'status']);
  const view = values.view === 'all' ? 'all' : 'waiting';
  const status = STATUSES.find((s) => s === values.status);
  const waiting = useWaitingForMe();
  const list = useMaterialRequests({ statuses: status ? [status] : undefined }, view === 'all');
  const waitingIds = useMemo(() => new Set((waiting.data ?? []).map((w) => w.requestId)), [waiting.data]);
  const setView = useCallback((v: 'waiting' | 'all') => setFilters({ view: v === 'all' ? 'all' : '', status: '' }), [setFilters]);
  const headers = useMaterialRequestHeaders([...waitingIds]);
  const headerById = new Map((headers.data ?? []).map(r => [r.id, r]));
  const requestOf = (id: string) => headerById.get(id);

  const waitingColumns: Column<WaitingStep>[] = [
    { key: 'number', header: t('list.columns.number', 'Request'), rowHeader: true,
      cell: (w) => <span className="font-semibold">{requestOf(w.requestId)?.number ?? '…'}</span> },
    { key: 'step', header: t('list.columns.step', 'Your step'), cell: (w) => <>
      {t('list.stepOf', 'Step {{n}}: {{label}}', { n: w.stepPosition, label: w.label })}
      {w.actingFor && <span className="ml-2 text-muted-foreground">{t('list.standingIn', 'standing in')}</span>}</> },
    { key: 'workOrder', header: t('list.columns.workOrder', 'Work order'),
      cell: (w) => {
        const r = requestOf(w.requestId);
        return r ? <RequestWorkOrder workOrderId={r.workOrderId} projectId={r.projectId} workOrder={r.workOrder} /> : '…';
      } },
    { key: 'needed', header: t('list.columns.neededBy', 'Needed by'), cell: (w) => {
      const r = requestOf(w.requestId);
      return r ? formatDay(r.neededBy) : '…';
    } },
    { key: 'sent', header: t('list.columns.submitted', 'Sent'), cell: (w) => formatDay(w.submittedAt) },
  ];
  const columns: Column<MaterialRequestListRow>[] = [
    { key: 'number', header: t('list.columns.number', 'Request'), rowHeader: true, cell: (r) => <span className="font-semibold">{r.number}</span> },
    { key: 'workOrder', header: t('list.columns.workOrder', 'Work order'), cell: (r) => <RequestWorkOrder workOrderId={r.workOrderId} projectId={r.projectId} workOrder={r.workOrder} /> },
    { key: 'status', header: t('list.columns.status', 'Status'), cell: (r) => <span className="flex flex-wrap items-center gap-2">
      <RequestStatusPill status={r.status} />
      {waitingIds.has(r.id) && <span className="text-control text-primary-text">{t('list.waitingForYou', 'Waiting for you')}</span>}</span> },
    { key: 'needed', header: t('list.columns.neededBy', 'Needed by'), cell: (r) => formatDay(r.neededBy) },
    { key: 'created', header: t('list.columns.raised', 'Raised'), cell: (r) => formatDay(r.createdAt) },
  ];

  const tab = (v: 'waiting' | 'all', label: string, count?: number) => (
    <button type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
      className={`min-h-11 border-b-2 px-3 text-control font-medium ${view === v ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`}>
      {label}{count !== undefined ? ` (${count})` : ''}
    </button>
  );

  return (
    <ListPage
      title={t('list.title', 'Material requests')}
      primaryAction={<span className="flex gap-2">
        <Link to="/material-requests/settings" className="inline-flex min-h-11 items-center text-control text-primary-text hover:underline">{t('list.settings', 'Approval settings')}</Link>
        <CanWrite entity="materialRequest" action="create">
          <Button variant="primary" onClick={() => navigate('/material-requests/new')}><Icon name="plus" />{t('list.new', 'New request')}</Button>
        </CanWrite>
      </span>}
    >
      <div role="tablist" aria-label={t('list.viewsLabel', 'Request views')} className="mb-3 flex border-b border-border">
        {tab('waiting', t('list.waiting', 'Waiting for me'), waiting.data?.length)}
        {tab('all', t('list.all', 'All requests'))}
      </div>

      {view === 'waiting' && <>
        {waiting.isPending && <ListState variant="loading" shape="table" rows={3} />}
        {!waiting.isPending && waiting.isError && (
          <ListState variant="error" title={t('list.waitingError', "Couldn't load your approvals")} sub={t('list.errorSub', 'The request failed. Check your connection and try again.')} onRetry={() => void waiting.refetch()} />
        )}
        {waiting.data && (waiting.data.length === 0
          ? <Card clip><ListState variant="empty" title={t('list.waitingEmpty', 'Nothing is waiting for you')} /></Card>
          : <DataTable<WaitingStep> rows={waiting.data} columns={waitingColumns} rowKey={(w) => `${w.requestId}:${w.stepPosition}`}
              onActivate={(w) => navigate(`/material-requests/${w.requestId}`)}
              rowLabel={(w) => t('list.rowLabel', 'Open {{number}}', { number: requestOf(w.requestId)?.number ?? w.requestId.slice(0, 8) })} tableId="material-requests-waiting" />)}
      </>}

      {view === 'all' && <>
        <div className="mb-3 max-w-xs">
          <SelectField label={t('list.filterStatus', 'Status')} value={status ?? ''} onChange={(v) => setFilters({ status: v })}
            options={[{ value: '', label: t('list.anyStatus', 'Any status') }, ...STATUSES.map((s) => ({ value: s, label: labels.status[s] }))]} />
        </div>
        {list.isPending && <ListState variant="loading" shape="table" rows={4} />}
        {!list.isPending && list.isError && (
          <ListState variant="error" title={t('list.error', "Couldn't load material requests")} sub={t('list.errorSub', 'The request failed. Check your connection and try again.')} onRetry={() => void list.refetch()} />
        )}
        {list.data && (list.data.rows.length === 0
          ? <Card clip><ListState variant="empty" title={t('list.empty', 'No material requests yet')} /></Card>
          : <DataTable<MaterialRequestListRow> rows={list.data.rows} columns={columns} rowKey={(r) => r.id}
              onActivate={(r) => navigate(`/material-requests/${r.id}`)}
              rowLabel={(r) => t('list.rowLabel', 'Open {{number}}', { number: r.number })} tableId="material-requests-table" />)}
      </>}
    </ListPage>
  );
};

export default MaterialRequestsPage;
