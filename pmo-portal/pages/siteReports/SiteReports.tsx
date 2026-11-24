import { useDsrStockFlags, useDsrStockSettings } from '@/src/hooks/useDsrStockIssue';
import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, ListState, PageHeader, SelectField, StatusPill } from '@/src/components/ui';
import { ScheduleThisReport } from '@/src/components/emailNotifications/ScheduleThisReport';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { can } from '@/src/auth/policy';
import { useDailySiteReports, useDsrValidationQueue } from '@/src/hooks/useDailySiteReports';
import { useCrews } from '@/src/hooks/useCrews';
import { formatDay } from '@/src/lib/format';
import type { DsrStatus } from '@/src/lib/db/dailySiteReports';
import { NewSiteReportDialog } from './NewSiteReportDialog';
import { CrewsLink } from './CrewsLink';

const STATUSES: DsrStatus[] = ['draft', 'submitted', 'returned', 'validated'];

/**
 * `/site-reports` (#1522): what waits on the viewer first (the QS validation queue, oldest first, FR-DSR-017),
 * then every report, newest first, filtered by status and paged (FR-DSR-021). Reads are RLS-scoped.
 */
const SiteReports: React.FC = () => {
  const { t } = useTranslation('siteReport');
  const navigate = useNavigate();
  const userId = useAuth().currentUser?.id ?? null;
  const { realRole } = useEffectiveRole();
  const [params, setParams] = useSearchParams();
  const status = (STATUSES as string[]).includes(params.get('status') ?? '') ? (params.get('status') as DsrStatus) : undefined;
  const crewId = params.get('crew') ?? '';
  const crews = useCrews();
  const page = Math.max(0, Number(params.get('page') ?? '0') || 0);
  const [newOpen, setNewOpen] = useState(false);

  // A PM's own-project check happens per record; at list level the role decides whether the doorway shows.
  const asOwnPm = { realRole, currentUserId: userId, record: { project_manager_id: userId } };
  const mayEnter = can('create', 'dailySiteReport', asOwnPm);
  const mayValidate = can('approve', 'dailySiteReport', { ...asOwnPm, record: { ...asOwnPm.record, author_id: null } });
  const filter = useMemo(() => ({ ...(status ? { status } : {}), ...(crewId ? { crewId } : {}) }), [status, crewId]);
  const list = useDailySiteReports(filter, page);
  const queue = useDsrValidationQueue(mayValidate);
  const stockOn = useDsrStockSettings().data?.enabled === true;
  const stockFlags = useDsrStockFlags((list.data?.rows ?? []).filter((r) => r.status === 'validated').map((r) => r.id), stockOn).data;

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null || value === '') next.delete(key); else next.set(key, value);
    if (key !== 'page') next.delete('page');
    setParams(next);
  };

  const queueRows = queue.data ?? [];
  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title', 'Site reports')}
        action={(
          <div className="flex flex-wrap items-center gap-2">
            <ScheduleThisReport kind="daily_progress" />
            {mayEnter ? <Button variant="primary" onClick={() => setNewOpen(true)}>{t('newReport', 'New report')}</Button> : null}
          </div>
        )}
      />
      <CrewsLink />

      {mayValidate && queueRows.length > 0 && (
        <section aria-labelledby="dsr-queue" className="rounded-lg border border-warning/30 bg-waiting-surface p-4" data-testid="dsr-queue">
          <h2 id="dsr-queue" className="text-base font-semibold text-foreground">
            {t('queue.title', 'To validate')} <span className="tabular-nums">{queueRows.length}</span>
          </h2>
          <ul className="mt-3 divide-y divide-border">
            {queueRows.map((q) => (
              <li key={q.report_id} className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1 py-2">
                <Link to={`/site-reports/${q.report_id}`} className="font-medium text-primary-text hover:underline">
                  {q.work_order_label} · {formatDay(q.work_date)}
                </Link>
                <span className="text-muted-foreground">{q.author_name ?? '—'}</span>
                {q.age_days > 0 && <span>{t('queue.due', { defaultValue: 'Due {{count}} days', count: q.age_days })}</span>}
                {q.unrated_lines > 0 && <StatusPill variant="warn">{t('queue.unrated', { defaultValue: '{{count}} without rate', count: q.unrated_lines })}</StatusPill>}
                {q.waiting_for_validator && <span>{t('queue.noValidator', 'Waiting for a validator')}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="dsr-list" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="dsr-list" className="text-base font-semibold text-foreground">{t('list.title', 'Reports')}</h2>
          <div className="flex flex-wrap items-end gap-3">
          {(crews.data ?? []).length > 0 && (
            <SelectField
              compact
              label={t('list.crew', 'Crew')}
              value={crewId}
              onChange={(v) => setParam('crew', v)}
              options={[{ value: '', label: t('list.allCrews', 'All crews') }, ...(crews.data ?? []).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))]}
            />
          )}
          <SelectField
            compact
            label={t('list.status', 'Status')}
            value={status ?? ''}
            onChange={(v) => setParam('status', v)}
            options={[{ value: '', label: t('list.allStatuses', 'All statuses') },
              ...STATUSES.map((s) => ({ value: s, label: t(`status:siteReport.${s}`) }))]}
          />
          </div>
        </div>
        {list.isPending ? (
          <ListState variant="loading" rows={4} />
        ) : list.isError ? (
          <ListState variant="error" title={t('list.error', "Couldn't load reports")} onRetry={() => void list.refetch()} />
        ) : list.data.rows.length === 0 ? (
          <ListState variant="empty" icon="reports" title={t('list.empty', 'No site reports yet')}
            action={mayEnter ? { label: t('newReport', 'New report'), onClick: () => setNewOpen(true) } : undefined} />
        ) : (
          <>
            <ul className="panel-card divide-y divide-border" data-testid="dsr-list">
              {list.data.rows.map((r) => (
                <li key={r.id}>
                  <Link to={`/site-reports/${r.id}`} className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 hover:bg-surface-hover">
                    <span className="tabular-nums text-foreground">{formatDay(r.work_date)}</span>
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground">{r.work_order_label}</span>
                    {r.crew_name && <span className="text-muted-foreground" data-testid="dsr-crew">{t('list.crewLabel', { defaultValue: 'Crew {{name}}', name: r.crew_name })}</span>}
                    <span className="text-muted-foreground">{r.author_name ?? '—'}</span>
                    {stockFlags?.has(r.id) && <StatusPill variant="warn" data-testid="dsr-stock-flag">{t('stock.flag', 'Stock flagged')}</StatusPill>}
                    <StatusPill record="siteReport" state={r.status} />
                  </Link>
                </li>
              ))}
            </ul>
            {(page > 0 || list.data.hasMore) && (
              <nav className="flex items-center justify-end gap-2" aria-label={t('list.pages', 'Pages')}>
                <Button variant="ghost" disabled={page === 0} onClick={() => setParam('page', String(page - 1))}>{t('list.previous', 'Previous')}</Button>
                <Button variant="ghost" disabled={!list.data.hasMore} onClick={() => setParam('page', String(page + 1))}>{t('list.next', 'Next')}</Button>
              </nav>
            )}
          </>
        )}
      </section>

      {newOpen && <NewSiteReportDialog onClose={() => setNewOpen(false)} onCreated={(id) => navigate(`/site-reports/${id}`)} />}
    </div>
  );
};

export default SiteReports;
