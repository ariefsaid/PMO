import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, EntityFormModal, ListState, PageHeader, RecordSection, SelectField, StatusPill, TextArea, TextField, useToast } from '@/src/components/ui';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { can } from '@/src/auth/policy';
import { useProjects } from '@/src/hooks/useProjects';
import { useOverContract, useQuantityChangeLimit, useQuantityChangeMutations, useQuantityChangeRequests } from '@/src/hooks/useQuantityChanges';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatDay } from '@/src/lib/format';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import type { OverContractRow } from '@/src/lib/db/quantityChanges';
import type { RequestStatus } from '@/src/lib/quantityChangeRules';
import { RaiseQuantityChangeDialog } from './RaiseQuantityChangeDialog';

const STATUSES: RequestStatus[] = ['draft', 'pending_approval', 'returned', 'approved', 'sent_to_client', 'client_accepted', 'client_declined', 'withdrawn'];

/**
 * `/quantity-changes` (#2578): what is over its contract quantity on a project, the requests on it, and the organisation's
 * request limit. Reads are RLS-scoped; every action mirrors a qcr_* function (can() is UX only).
 */
const QuantityChanges: React.FC = () => {
  const { t } = useTranslation(['quantityChanges', 'status']);
  const navigate = useNavigate();
  const userId = useAuth().currentUser?.id ?? null;
  const { realRole } = useEffectiveRole();
  const [params, setParams] = useSearchParams();
  const status = (STATUSES as string[]).includes(params.get('status') ?? '') ? (params.get('status') as RequestStatus) : undefined;
  const projectId = params.get('project') ?? '';
  const page = Math.max(0, Number(params.get('page') ?? '0') || 0);
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [forecastFor, setForecastFor] = useState<OverContractRow | null>(null);

  const mayRaise = can('create', 'quantityChange', { realRole, currentUserId: userId });
  const mayLimit = can('manage', 'quantityChange', { realRole });
  const projects = useProjects();
  const projectOptions = useMemo(() => (projects.data ?? []).map((p) => ({ value: p.id, label: projectDisplayName(p) })), [projects.data]);
  const mayForecast = (() => {
    const pm = (projects.data ?? []).find((p) => p.id === projectId)?.project_manager_id ?? null;
    return can('request', 'quantityChange', { realRole, currentUserId: userId, record: { project_manager_id: pm } });
  })();
  const filter = useMemo(() => ({ ...(status ? { status } : {}), ...(projectId ? { projectId } : {}) }), [status, projectId]);
  const list = useQuantityChangeRequests(filter, page);
  const over = useOverContract(projectId || undefined, true);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null || value === '') next.delete(key); else next.set(key, value);
    if (key !== 'page') next.delete('page');
    setParams(next);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('quantityChanges:title', 'Quantity change requests')}
        action={mayRaise ? <Button variant="primary" onClick={() => setRaiseOpen(true)}>{t('quantityChanges:newRequest', 'New request')}</Button> : undefined}
      />

      <div className="flex flex-wrap items-end gap-3">
        <SelectField compact label={t('quantityChanges:list.project', 'Project')} value={projectId} onChange={(v) => setParam('project', v)}
          options={[{ value: '', label: t('quantityChanges:list.allProjects', 'All projects') }, ...projectOptions]} />
        <SelectField compact label={t('quantityChanges:list.status', 'Status')} value={status ?? ''} onChange={(v) => setParam('status', v)}
          options={[{ value: '', label: t('quantityChanges:list.allStatuses', 'All statuses') }, ...STATUSES.map((s) => ({ value: s, label: t(`status:quantityChange.${s}`) }))]} />
      </div>

      <RecordSection title={t('quantityChanges:over.title', 'Over contract')} data-testid="qcr-over">
        {!projectId ? (
          <p className="text-muted-foreground">{t('quantityChanges:over.pickProject', 'Choose a project to see its contract lines')}</p>
        ) : over.isPending ? (
          <ListState variant="loading" rows={3} />
        ) : over.isError ? (
          <ListState variant="error" title={t('quantityChanges:over.error', "Couldn't load contract lines")} onRetry={() => void over.refetch()} />
        ) : over.data.length === 0 ? (
          <p className="text-muted-foreground">{t('quantityChanges:over.none', 'No contract line is over its contract quantity')}</p>
        ) : (
          <ul className="divide-y divide-border" data-testid="qcr-over-list">
            {over.data.map((r) => {
              const figure = r.over_progress ? r.progress_quantity : (r.forecast_quantity ?? 0);
              return (
                <li key={r.boq_item_id} className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1 py-2" data-testid="qcr-over-row">
                  <StatusPill variant="warn">{t('quantityChanges:over.flag', 'Over contract')}</StatusPill>
                  <span className="min-w-0 flex-1 font-medium text-foreground">{r.item_code} · {r.description}</span>
                  <span className="tabular-nums text-foreground">
                    {t('quantityChanges:over.contract', 'Contract')} {r.contract_quantity} {r.unit}
                  </span>
                  <span className="tabular-nums text-foreground">
                    {t(`quantityChanges:over.kind.${r.over_progress ? 'progress' : 'forecast'}`)} {figure}
                    {r.over_progress && r.progress_source ? ` (${t(`quantityChanges:over.source.${r.progress_source}`)})` : ''}
                  </span>
                  <span className="tabular-nums text-foreground">{t('quantityChanges:over.overBy', { defaultValue: 'Over by {{quantity}} {{unit}}', quantity: Math.round((figure - r.contract_quantity) * 1000) / 1000, unit: r.unit })}</span>
                  {r.open_request_id && <Link to={`/quantity-changes/${r.open_request_id}`} className="text-primary-text hover:underline">{t('quantityChanges:over.openRequest', 'Open request')}</Link>}
                  {mayForecast && <Button variant="ghost" onClick={() => setForecastFor(r)}>{t('quantityChanges:over.recordForecast', 'Record forecast')}</Button>}
                </li>
              );
            })}
          </ul>
        )}
      </RecordSection>

      <RecordSection title={t('quantityChanges:list.title', 'Requests')} data-testid="qcr-requests">
        {list.isPending ? (
          <ListState variant="loading" rows={4} />
        ) : list.isError ? (
          <ListState variant="error" title={t('quantityChanges:list.error', "Couldn't load requests")} onRetry={() => void list.refetch()} />
        ) : list.data.rows.length === 0 ? (
          <p className="text-muted-foreground">{t('quantityChanges:list.empty', 'No quantity change requests yet')}</p>
        ) : (
          <>
            <ul className="divide-y divide-border" data-testid="qcr-list">
              {list.data.rows.map((r) => (
                <li key={r.id}>
                  <Link to={`/quantity-changes/${r.id}`} className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1 py-2 hover:bg-surface-hover">
                    <span className="tabular-nums text-foreground">{formatDay(r.created_at)}</span>
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground">{r.work_order_label}</span>
                    <span className="text-muted-foreground">{t('quantityChanges:list.line', { count: r.line_count, defaultValue: '{{count}} lines' })}</span>
                    <span className="text-muted-foreground">{r.author_name ?? '—'}</span>
                    <StatusPill record="quantityChange" state={r.status} />
                  </Link>
                </li>
              ))}
            </ul>
            {(page > 0 || list.data.hasMore) && (
              <nav className="mt-3 flex items-center justify-end gap-2" aria-label={t('quantityChanges:list.pages', 'Pages')}>
                <Button variant="ghost" disabled={page === 0} onClick={() => setParam('page', String(page - 1))}>{t('quantityChanges:list.previous', 'Previous')}</Button>
                <Button variant="ghost" disabled={!list.data.hasMore} onClick={() => setParam('page', String(page + 1))}>{t('quantityChanges:list.next', 'Next')}</Button>
              </nav>
            )}
          </>
        )}
      </RecordSection>

      {mayLimit && <LimitSection />}
      {raiseOpen && <RaiseQuantityChangeDialog presetProjectId={projectId || undefined} onClose={() => setRaiseOpen(false)} onCreated={(id) => navigate(`/quantity-changes/${id}`)} />}
      {forecastFor && <ForecastDialog row={forecastFor} onClose={() => setForecastFor(null)} />}
    </div>
  );
};

/** FR-QCR-021: the Admin sets the per-work-order limit; empty means none. The write is an Admin-only column grant. */
const LimitSection: React.FC = () => {
  const { t } = useTranslation('quantityChanges');
  const { toast } = useToast();
  const query = useQuantityChangeLimit();
  const { setLimit } = useQuantityChangeMutations();
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? (query.data === null || query.data === undefined ? '' : String(query.data));
  const invalid = value.trim() !== '' && !/^[1-9]\d{0,5}$/.test(value.trim());
  const save = async () => {
    if (invalid) return;
    try {
      await setLimit.mutateAsync(value.trim() === '' ? null : Number(value.trim()));
      setDraft(null);
      toast(t('limit.saved', 'Limit saved'), '', 'success');
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };
  return (
    <RecordSection title={t('limit.title', 'Request limit')} data-testid="qcr-limit">
      <div className="flex flex-wrap items-end gap-3">
        <TextField label={t('limit.label', 'Limit per work order')} inputMode="numeric" value={value} onChange={setDraft}
          helper={t('limit.help', 'The most quantity change requests one work order may raise. Leave empty for no limit.')}
          error={invalid ? t('limit.invalid', 'A whole number of 1 or more') : undefined} />
        <Button variant="primary" onClick={() => void save()} loading={setLimit.isPending} disabled={invalid || draft === null}>{t('limit.save', 'Save limit')}</Button>
      </div>
    </RecordSection>
  );
};

const ForecastDialog: React.FC<{ row: OverContractRow; onClose: () => void }> = ({ row, onClose }) => {
  const { t } = useTranslation('quantityChanges');
  const { toast } = useToast();
  const { recordForecast } = useQuantityChangeMutations();
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const valid = /^\d+(\.\d{1,3})?$/.test(quantity.trim()) && Number(quantity) > 0;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    try {
      await recordForecast.mutateAsync({ boqItemId: row.boq_item_id, quantity: quantity.trim(), note: note.trim() || null });
      toast(t('over.forecastSaved', 'Forecast recorded'), `${row.item_code}`, 'success');
      onClose();
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      setError(detail ? `${headline}. ${detail}` : headline);
    }
  };
  return (
    <EntityFormModal open title={t('over.forecastTitle', 'Forecast quantity at completion')} submitLabel={t('over.forecastSave', 'Save forecast')}
      onSubmit={(e) => void submit(e)} onClose={onClose} submitDisabled={!valid} loading={recordForecast.isPending} submitError={error ? { headline: error } : null}>
      <p className="text-foreground">{row.item_code} · {row.description}</p>
      <TextField label={t('over.forecastLabel', { defaultValue: 'Expected final quantity ({{unit}})', unit: row.unit })} inputMode="decimal" value={quantity} onChange={setQuantity} />
      <TextArea label={t('over.forecastNote', 'Note')} value={note} maxLength={500} onChange={setNote} />
    </EntityFormModal>
  );
};

export default QuantityChanges;
