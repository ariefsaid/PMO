import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  Button, ListState, MobileDecisionBar, ReasonDialog, RecordHeader, RecordSection, RecordStack, SelectField, StatusPill,
  TextArea, TextField, useToast, type MobileDecisionAction,
} from '@/src/components/ui';
import { BackBar } from '@/src/components/shell';
import { useIsNarrow } from '@/src/components/ui/useIsNarrow';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { can } from '@/src/auth/policy';
import { useProject } from '@/src/hooks/useProjects';
import {
  useDailySiteReport, useDailySiteReportMutations, useDailySiteReportRevenue, useDsrLookups, useWorkOrderValidatedRevenue,
} from '@/src/hooks/useDailySiteReports';
import { repositories } from '@/src/lib/repositories';
import { classifyMutationError, joinSentences } from '@/src/lib/classifyMutationError';
import { formatCurrency, formatDay } from '@/src/lib/format';
import { dsrReportRevenue } from '@/src/lib/dsrRevenue';
import type { DsrReportDetail } from '@/src/lib/db/dailySiteReports';
import {
  siteReportDraftInput, siteReportFormFromDetail, validateSiteReportForm, workingMinutes, type SiteReportForm,
} from './siteReportForm';
import { missingPartsFrom } from './emptyReport';
import { SiteReportPhotos } from './SiteReportPhotos';
import { SiteCheckpoints } from './SiteCheckpoints';
import { SiteReportStock } from './SiteReportStock';
import { useDsrStockSettings } from '@/src/hooks/useDsrStockIssue';

type Dialog = 'return' | 'correct' | null;

const hours = (minutes: number | null) => (minutes === null ? '—' : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`);

/**
 * `/site-reports/:reportId` (#1522). Phone first: the day's sections in entry order, the decision bar in view.
 * Shows only what the server would allow (`can()` mirrors dsr_* RPCs; the RPCs decide). Money shows only to the
 * rate catalogue's readers; quantities show to everyone who can read the report.
 */
const SiteReportDetail: React.FC = () => {
  const { reportId } = useParams<{ reportId: string }>();
  const query = useDailySiteReport(reportId);
  const { t } = useTranslation('siteReport');
  const navigate = useNavigate();
  const back = <div className="hidden max-[920px]:block"><BackBar label={t('title', 'Site reports')} onBack={() => navigate('/site-reports')} /></div>;
  if (query.isPending) return (<>{back}<ListState variant="loading" rows={6} /></>);
  if (query.isError) return (<>{back}<ListState variant="error" title={t('detail.error', "Couldn't load this report")} onRetry={() => void query.refetch()} /></>);
  if (!query.data) return (<>{back}<ListState variant="empty" icon="reports" title={t('detail.notFound', 'Report not found')} /></>);
  return (<>{back}<SiteReportRecord detail={query.data} /></>);
};

const SiteReportRecord: React.FC<{ detail: DsrReportDetail }> = ({ detail }) => {
  const { t } = useTranslation(['siteReport', 'status']);
  const navigate = useNavigate();
  const { toast } = useToast();
  const narrow = useIsNarrow();
  const userId = useAuth().currentUser?.id ?? null;
  const { realRole } = useEffectiveRole();
  const { report } = detail;
  const project = useProject(report.project_id).data ?? null;
  const ctx = { realRole, currentUserId: userId, record: { author_id: report.author_id, project_manager_id: project?.project_manager_id ?? null } };
  const editable = (report.status === 'draft' || report.status === 'returned')
    && (report.author_id === userId || can('create', 'dailySiteReport', ctx));
  const mayWithdraw = report.status === 'submitted' && report.author_id === userId;
  const mayValidate = report.status === 'submitted' && can('approve', 'dailySiteReport', ctx);
  const mayCorrect = report.status === 'validated' && !report.superseded_at && can('revise', 'dailySiteReport', ctx);
  const seeRevenue = can('view', 'dailySiteReportRevenue', ctx);

  const lookups = useDsrLookups(report.work_order_id, report.id);
  const stock = useQuery({ queryKey: ['daily-site-reports', 'stock-items'], queryFn: () => repositories.stock.master.listItems(false), enabled: editable || detail.consumables.length > 0 });
  const revenue = useDailySiteReportRevenue(report.id, seeRevenue);
  const woRevenue = useWorkOrderValidatedRevenue(report.work_order_id, seeRevenue);
  const m = useDailySiteReportMutations();
  const stockOn = useDsrStockSettings().data?.enabled === true;

  const [form, setForm] = useState<SiteReportForm>(() => siteReportFormFromDetail(detail));
  const [dirty, setDirty] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  useEffect(() => { if (!dirty) setForm(siteReportFormFromDetail(detail)); }, [detail, dirty]);
  const errors = validateSiteReportForm(form);
  const update = (patch: Partial<SiteReportForm>) => { setForm((f) => ({ ...f, ...patch })); setDirty(true); };
  const errText = (key: string) => {
    if (!showErrors || !errors[key]) return undefined;
    return errors[key] === 'required' ? t('form.required', 'Required') : errors[key] === 'minutes' ? t('form.minutes', '1 to 1440 minutes') : t('form.positive', 'More than 0, up to 3 decimals');
  };

  const itemsData = lookups.items.data;
  const items = useMemo(() => itemsData ?? [], [itemsData]);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const currency = detail.workOrder?.currency ?? 'XXX';
  const money = (v: string | number) => formatCurrency(Number(v), currency, { precision: 'minor' });
  const rateByLine = new Map((revenue.data ?? []).map((r) => [r.line_id, r]));
  // Saved lines carry the server's rate (live for a draft, frozen once validated); the exact total is summed here.
  const lineRevenue = dsrReportRevenue(detail.progress.map((l) => ({ quantity: l.quantity, rate: rateByLine.get(l.id)?.rate ?? null })));

  const run = async (work: () => Promise<unknown>, success: string) => {
    try { await work(); toast(success, detail.workOrder?.label ?? '', 'success'); return true; } catch (err) {
      const missing = missingPartsFrom(err);
      if (missing) {
        const words = { progress: t('empty.progress', 'progress'), hours: t('empty.hours', 'start and end time'), photo: t('empty.photo', 'a photo') };
        const list = missing.map((part) => words[part]).join(', ');
        const headline = t('empty.headline', 'This report is empty');
        const d = t('empty.detail', { defaultValue: 'Add at least one of: {{list}}.', list });
        toast(headline, d, 'warning');
        setDialogError(joinSentences(headline, d));
        return false;
      }
      const { headline, detail: d } = classifyMutationError(err);
      toast(headline, d, 'warning');
      setDialogError(d ? joinSentences(headline, d) : headline);
      return false;
    }
  };
  const save = async () => {
    setShowErrors(true);
    if (Object.keys(errors).length > 0) return false;
    const ok = await run(() => m.save.mutateAsync(siteReportDraftInput(form, { id: report.id, workOrderId: report.work_order_id, workDate: report.work_date, variantId: report.variant_id })), t('toast.saved', 'Draft saved'));
    if (ok) setDirty(false);
    return ok;
  };
  const submit = async () => {
    if (!(await save())) return;
    // The author is told at send what the validator will still need (the rule is the validator's, shown to both).
    const missingPhoto = !detail.photos.some((p) => p.kind === 'paper_form');
    await run(() => m.submit.mutateAsync(report.id), missingPhoto
      ? t('toast.submittedNeedsPhoto', 'Sent for validation. The validator needs a photo of the paper form: add it.')
      : t('toast.submitted', 'Sent for validation'));
  };
  const withdraw = () => run(() => m.withdraw.mutateAsync(report.id), t('toast.withdrawn', 'Report taken back. You can edit it again.'));
  const validate = () => run(() => m.validate.mutateAsync(report.id), t('toast.validated', 'Report validated'));
  const hasPaperForm = detail.photos.some((p) => p.kind === 'paper_form');

  const decisionActions: MobileDecisionAction[] = [
    ...(editable ? [
      { key: 'save', label: t('actions.save', 'Save draft'), variant: 'outline' as const, onSelect: () => void save(), loading: m.save.isPending },
      { key: 'submit', label: t('actions.submit', 'Submit'), onSelect: () => void submit(), loading: m.submit.isPending },
    ] : []),
    ...(mayWithdraw ? [{ key: 'withdraw', label: t('actions.withdraw', 'Withdraw'), variant: 'outline' as const, onSelect: () => void withdraw(), loading: m.withdraw.isPending }] : []),
    ...(mayValidate ? [
      { key: 'return', label: t('actions.return', 'Return'), variant: 'outline' as const, onSelect: () => { setDialogError(null); setDialog('return'); } },
      { key: 'validate', label: t('actions.validate', 'Validate'), onSelect: () => void validate(), loading: m.validate.isPending, disabled: !hasPaperForm },
    ] : []),
    ...(mayCorrect ? [{ key: 'correct', label: t('actions.correct', 'Correct'), variant: 'outline' as const, onSelect: () => { setDialogError(null); setDialog('correct'); } }] : []),
  ];

  const total = workingMinutes(form.startTime, form.endTime);
  const peopleHours = lookups.hours.data?.peopleHours ?? '0';
  const equipmentHours = lookups.hours.data?.equipment ?? [];
  const lastReturn = [...detail.events].reverse().find((e) => e.action === 'returned');

  return (
    <div className="max-sm:pb-[var(--mobile-action-bar-height,0px)]">
      <RecordHeader
        panelInset
        actionsOnTitleRow
        clampNameOnMobile
        name={detail.workOrder?.label ?? t('detail.title', 'Site report')}
        status={<span data-testid="dsr-status" data-status={report.status}><StatusPill record="siteReport" state={report.status} /></span>}
        meta={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{formatDay(report.work_date)}</span>
            {project && <Link to={`/projects/${project.id}`} className="text-primary-text hover:underline">{project.name}</Link>}
            {report.version > 1 && <span>{t('detail.version', { defaultValue: 'Version {{n}}', n: report.version })}</span>}
          </span>
        }
        stats={seeRevenue ? [
          { label: t('revenue.day', 'Day revenue'), value: <span data-testid="dsr-total">{money(lineRevenue.total)}</span> },
          ...(woRevenue.data !== undefined && detail.workOrder ? [{ label: t('revenue.toDate', 'Validated to date'), value: `${money(woRevenue.data)} / ${money(detail.workOrder.orderValue)}` }] : []),
        ] : undefined}
        actions={narrow ? undefined : (
          <div className="flex flex-wrap gap-2">
            {decisionActions.map((a) => (
              <Button key={a.key} variant={a.variant ?? 'primary'} onClick={a.onSelect} loading={a.loading} disabled={a.disabled}>{a.label}</Button>
            ))}
          </div>
        )}
      >
        {editable && !hasPaperForm && <p className="text-foreground" role="status" data-testid="dsr-author-needs-photo">{t('detail.needsPhotoAuthor', 'Add a photo of the paper form before you send. The validator cannot accept the report without it.')}</p>}
        {mayValidate && !hasPaperForm && <p className="text-foreground">{t('detail.needsPhoto', 'A photo of the paper form is needed to validate')}</p>}
        {report.superseded_at && <p className="text-foreground">{t('detail.superseded', 'Replaced by a correction')}</p>}
        {report.correction_reason && <p className="text-foreground">{t('detail.correction', { defaultValue: 'Correction: {{reason}}', reason: report.correction_reason })}</p>}
      </RecordHeader>

      <RecordStack>
        {report.status === 'returned' && (
          <div role="status" className="rounded-lg border border-warning/30 bg-waiting-surface px-3.5 py-3" data-testid="dsr-returned">
            <div className="font-semibold text-warning-foreground">{t('status:siteReport.returned', 'Returned')}{lastReturn ? ` · ${formatDay(lastReturn.at)}` : ''}</div>
            <div className="text-foreground">{report.returned_reason}</div>
          </div>
        )}

        <RecordSection title={t('progress.title', 'Progress')} data-testid="dsr-progress">
          {seeRevenue && lineRevenue.unratedCount > 0 && (
            <p className="text-foreground">{t('progress.unrated', { defaultValue: '{{count}} lines without a rate', count: lineRevenue.unratedCount })}</p>
          )}
          {form.progress.length === 0 && !editable && <p className="text-muted-foreground">{t('progress.none', 'No progress recorded')}</p>}
          {editable && itemsData !== undefined && items.length === 0 && (
            <p className="text-foreground" data-testid="dsr-no-items">
              {project?.pm?.full_name
                ? t('progress.noItemsAsk', { defaultValue: 'This work order has no items yet. Ask {{name}}.', name: project.pm.full_name })
                : t('progress.noItems', 'This work order has no items yet. Ask the project manager.')}
            </p>
          )}
          {form.progress.length > 0 && <ul className="space-y-3">
            {form.progress.map((line, i) => {
              const saved = detail.progress[i];
              const rated = saved && saved.work_order_line_id === line.workOrderLineId ? lineRevenue.lines[i] : undefined;
              const item = itemById.get(line.workOrderLineId);
              return (
                <li key={i} className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
                  {editable ? (
                    <>
                      <SelectField label={t('progress.item', 'Contract item')} value={line.workOrderLineId} error={errText(`progress.${i}.item`)}
                        onChange={(v) => update({ progress: form.progress.map((p, j) => (j === i ? { ...p, workOrderLineId: v } : p)) })}
                        options={[{ value: '', label: t('progress.pickItem', 'Choose an item') }, ...items.map((it) => ({ value: it.id, label: `${it.item_code} · ${it.description}` }))]} />
                      <TextField label={t('progress.stage', 'Sub-stage')} value={line.subStage}
                        onChange={(v) => update({ progress: form.progress.map((p, j) => (j === i ? { ...p, subStage: v } : p)) })} />
                      <TextField label={`${t('progress.quantity', 'Quantity')}${item ? ` (${item.unit})` : ''}`} inputMode="decimal" value={line.quantity} error={errText(`progress.${i}.quantity`)}
                        onChange={(v) => update({ progress: form.progress.map((p, j) => (j === i ? { ...p, quantity: v } : p)) })} />
                      <Button variant="ghost" onClick={() => update({ progress: form.progress.filter((_, j) => j !== i) })}>{t('form.remove', 'Remove')}</Button>
                    </>
                  ) : (
                    <>
                      <span className="text-foreground">{item ? `${item.item_code} · ${item.description}` : '—'}{line.subStage ? ` · ${line.subStage}` : ''}</span>
                      <span className="tabular-nums text-foreground">{line.quantity} {saved?.unit ?? item?.unit ?? ''}</span>
                    </>
                  )}
                  {seeRevenue && rated && (
                    <span className="tabular-nums text-foreground sm:text-right" data-testid="dsr-line-amount">
                      {rated.unrated ? <StatusPill variant="warn">{t('progress.noRate', 'No rate')}</StatusPill> : money(rated.amount as string)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>}
          {editable && (
            <Button variant="outline" className="mt-3" onClick={() => update({ progress: [...form.progress, { workOrderLineId: '', subStage: '', quantity: '' }] })}>
              {t('progress.add', 'Add progress')}
            </Button>
          )}
        </RecordSection>

        <RecordSection title={t('hours.title', 'Hours and weather')}>
          <div className="grid gap-3 sm:grid-cols-3">
            <TextField label={t('hours.start', 'Start')} type="time" value={form.startTime} disabled={!editable} onChange={(v) => update({ startTime: v })} />
            <TextField label={t('hours.end', 'End')} type="time" value={form.endTime} disabled={!editable} onChange={(v) => update({ endTime: v })} />
            <p className="self-end text-foreground"><span className="text-muted-foreground">{t('hours.total', 'Total')}</span> <span className="tabular-nums">{hours(total)}</span></p>
          </div>
          {form.idle.length > 0 && <ul className="mt-3 space-y-3">
            {form.idle.map((idle, i) => (
              <li key={i} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] sm:items-end">
                <TextField label={t('hours.idleMinutes', 'Idle minutes')} inputMode="numeric" value={idle.minutes} disabled={!editable} error={errText(`idle.${i}.minutes`)}
                  onChange={(v) => update({ idle: form.idle.map((p, j) => (j === i ? { ...p, minutes: v } : p)) })} />
                <SelectField label={t('hours.idleReason', 'Reason')} value={idle.reasonId} disabled={!editable} error={errText(`idle.${i}.reason`)}
                  onChange={(v) => update({ idle: form.idle.map((p, j) => (j === i ? { ...p, reasonId: v } : p)) })}
                  options={[{ value: '', label: t('hours.pickReason', 'Choose a reason') }, ...(lookups.idle.data ?? []).map((o) => ({ value: o.id, label: o.label }))]} />
                {editable && <Button variant="ghost" onClick={() => update({ idle: form.idle.filter((_, j) => j !== i) })}>{t('form.remove', 'Remove')}</Button>}
              </li>
            ))}
          </ul>}
          {editable && (
            <Button variant="outline" className="mt-3" onClick={() => update({ idle: [...form.idle, { minutes: '', reasonId: '' }] })}>{t('hours.addIdle', 'Add idle time')}</Button>
          )}
          <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <SelectField label={t('hours.weather', 'Weather')} value={form.weatherId} disabled={!editable} onChange={(v) => update({ weatherId: v })}
              options={[{ value: '', label: t('hours.pickWeather', 'Not recorded') }, ...(lookups.weather.data ?? []).map((o) => ({ value: o.id, label: o.label }))]} />
            <TextField label={t('hours.weatherNote', 'Weather note')} value={form.weatherNote} disabled={!editable} onChange={(v) => update({ weatherNote: v })} />
          </div>
        </RecordSection>

        {(editable || form.consumables.length > 0) && <RecordSection title={t('consumables.title', 'Consumables used')}>
          {form.consumables.length > 0 && <ul className="space-y-3">
            {form.consumables.map((c, i) => (
              <li key={i} className={stockOn && items.length > 1 ? 'grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.5fr)_auto] sm:items-end' : 'grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-end'}>
                <SelectField label={t('consumables.item', 'Stock item')} value={c.stockItemId} disabled={!editable} error={errText(`consumables.${i}.item`)}
                  onChange={(v) => update({ consumables: form.consumables.map((p, j) => (j === i ? { ...p, stockItemId: v } : p)) })}
                  options={[{ value: '', label: t('consumables.pickItem', 'Choose an item') }, ...(stock.data ?? []).map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))]} />
                <TextField label={t('consumables.quantity', 'Quantity')} inputMode="decimal" value={c.quantity} disabled={!editable} error={errText(`consumables.${i}.quantity`)}
                  onChange={(v) => update({ consumables: form.consumables.map((p, j) => (j === i ? { ...p, quantity: v } : p)) })} />
                {stockOn && items.length > 1 && (
                  <SelectField label={t('consumables.workItem', 'Used on contract item')} value={c.workOrderLineId ?? ''} disabled={!editable}
                    onChange={(v) => update({ consumables: form.consumables.map((p, j) => (j === i ? { ...p, workOrderLineId: v || undefined } : p)) })}
                    options={[{ value: '', label: t('consumables.anyItem', 'Not named') }, ...items.map((it) => ({ value: it.id, label: `${it.item_code} · ${it.description}` }))]} />
                )}
                {editable && <Button variant="ghost" onClick={() => update({ consumables: form.consumables.filter((_, j) => j !== i) })}>{t('form.remove', 'Remove')}</Button>}
              </li>
            ))}
          </ul>}
          {editable && (
            <Button variant="outline" className="mt-3" onClick={() => update({ consumables: [...form.consumables, { stockItemId: '', quantity: '' }] })}>{t('consumables.add', 'Add consumable')}</Button>
          )}
        </RecordSection>}

        {report.status === 'validated' && <SiteReportStock reportId={report.id} workOrderId={report.work_order_id} enabled={stockOn} />}

        <RecordSection title={t('equipment.title', 'Equipment hours')} data-testid="dsr-equipment"
          actions={editable ? <Link to="/equipment" className="text-primary-text hover:underline">{t('equipment.add', 'Add usage')}</Link> : undefined}>
          {equipmentHours.length === 0 ? (
            <p className="text-muted-foreground">{t('equipment.none', 'No equipment usage on this work order and date')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {equipmentHours.map((e) => (
                <li key={e.id} className="flex min-h-11 items-center justify-between gap-3 py-2">
                  <span className="text-foreground">{e.asset_name}</span>
                  <span className="tabular-nums text-foreground">{e.quantity} {t(`equipment.unit.${e.unit}`, e.unit)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-foreground"><span className="text-muted-foreground">{t('people.title', 'People hours')}</span> <span className="tabular-nums">{peopleHours}</span></p>
        </RecordSection>

        <SiteCheckpoints workOrderId={report.work_order_id} workDate={report.work_date} projectManagerId={project?.project_manager_id ?? null} canRecordDay />

        <SiteReportPhotos report={report} photos={detail.photos} canWrite={editable} />

        <RecordSection title={t('note.title', 'Note')}>
          <TextArea label={t('note.title', 'Note')} hideLabel value={form.note} disabled={!editable} onChange={(v) => update({ note: v })} maxLength={2000} />
        </RecordSection>

        <RecordSection title={t('history.title', 'History')}>
          <ol className="space-y-1">
            {detail.events.map((e) => (
              <li key={e.id} className="text-foreground">
                <span className="tabular-nums text-muted-foreground">{formatDay(e.at)}</span> {t(`history.${e.action}`, e.action)}{e.reason ? ` · ${e.reason}` : ''}
              </li>
            ))}
          </ol>
        </RecordSection>
      </RecordStack>

      {narrow && decisionActions.length > 0 && <MobileDecisionBar actions={decisionActions} label={t('actions.label', 'Report actions')} />}

      <ReasonDialog
        open={dialog === 'return'}
        kind="return"
        subject={t('detail.subject', 'site report')}
        maxLength={500}
        loading={m.returnReport.isPending}
        error={dialogError}
        onCancel={() => setDialog(null)}
        onConfirm={(reason) => void run(() => m.returnReport.mutateAsync({ id: report.id, reason }), t('toast.returned', 'Report returned')).then((ok) => ok && setDialog(null))}
      />
      <ReasonDialog
        open={dialog === 'correct'}
        kind="return"
        title={t('correct.title', 'Correct this report')}
        label={t('correct.label', 'Reason for the correction')}
        confirmLabel={t('correct.confirm', 'Start correction')}
        maxLength={500}
        loading={m.correct.isPending}
        error={dialogError}
        onCancel={() => setDialog(null)}
        onConfirm={(reason) => void (async () => {
          try {
            const id = await m.correct.mutateAsync({ id: report.id, reason });
            setDialog(null);
            navigate(`/site-reports/${id}`);
          } catch (err) {
            const { headline, detail: d } = classifyMutationError(err);
            setDialogError(d ? joinSentences(headline, d) : headline);
          }
        })()}
      />
    </div>
  );
};

export default SiteReportDetail;
