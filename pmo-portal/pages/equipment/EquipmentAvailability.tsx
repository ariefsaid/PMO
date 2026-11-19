import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileInput } from '@/src/components/ui/FormFields';
import { FileCell } from '@/src/components/FileCell';
import { Badge, Button, Checkbox, ListPage, ListState, SelectField, TextField, useToast } from '@/src/components/ui';
import { CanWrite, usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useEquipmentAssetPages } from '@/src/hooks/useEquipment';
import { useCompanies } from '@/src/hooks/useCompanies';
import { useOrgToday } from '@/src/hooks/useOrgToday';
import { useOrgBusinessTimezone } from '@/src/hooks/useResolvedLocale';
import {
  useAttachProof, useDowntimeFlags, useEquipmentMetrics, useRentalTerms, useRentalTermHistory, useEquipmentOwnership, useChangeRentalRate, useEquipmentWorkingHours, useSetStatusBulk, useStatusDays, useLatestStatusDays, useEquipmentProofs,
} from '@/src/hooks/useEquipmentAvailability';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { isDownStatus, type EquipmentStatus } from '@/src/lib/equipmentMetrics';
import { monthStart } from './equipmentWeek';
import RentalInvoiceCheck from './RentalInvoiceCheck';

const STATUSES: EquipmentStatus[] = ['ready', 'standby', 'broken', 'at_vendor', 'waiting_parts'];

/** Static t() calls so the catalogue gates see every key (the pattern of `equipmentLabels`). */
function statusLabel(t: ReturnType<typeof useTranslation>['t'], s: EquipmentStatus): string {
  switch (s) {
    case 'ready': return t('equipment:availability.status.ready', 'Ready');
    case 'standby': return t('equipment:availability.status.standby', 'Standby');
    case 'broken': return t('equipment:availability.status.broken', 'Broken');
    case 'at_vendor': return t('equipment:availability.status.at_vendor', 'At vendor');
    case 'waiting_parts': return t('equipment:availability.status.waiting_parts', 'Waiting for parts');
  }
}

function ProofUpload({ code, onFile }: { code: string; onFile: (file: File | undefined) => void }) {
  const { t } = useTranslation();
  const input = React.useRef<HTMLInputElement>(null);
  return <span>
    <FileCell status="Draft" filePath={null} title={code} onUpload={() => input.current?.click()} />
    <FileInput ref={input} className="sr-only" aria-label={t('equipment:availability.proofFor', 'Attach proof for {{code}}', { code })} accept="image/*,application/pdf" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; onFile(file); }} />
  </span>;
}

/** Equipment → Availability (#2526): set today's status for every machine (phone-first), see availability and utilisation,
 *  with organisation-scoped terms and working hours. UX only; the RPCs enforce. */
const EquipmentAvailabilityPage: React.FC = () => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  const writeCtx = { record: { viewOnly: realRole !== effectiveRole } };
  const timezone = useOrgBusinessTimezone();
  const today = useOrgToday(timezone);
  const monthFrom = monthStart(today);

  const [view, setView] = useState<'status' | 'terms'>('status');
  const [chosenStatusDate, setStatusDate] = useState<string | null>(null);
  const statusDate = chosenStatusDate ?? today;
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [uploadedProofs, setUploadedProofs] = useState<Set<string>>(() => new Set());
  const assets = useEquipmentAssetPages();
  const [assetPage, setAssetPage] = useState(0);
  const pages = assets.data?.pages ?? [];
  const rows = pages[assetPage]?.rows ?? [];
  const nextPage = async () => {
    if (assetPage + 1 < pages.length) { setAssetPage(assetPage + 1); setMetricAssets([]); setTermAsset(''); return; }
    const next = await assets.fetchNextPage();
    if (next.data && next.data.pages.length > assetPage + 1) { setAssetPage(assetPage + 1); setMetricAssets([]); setTermAsset(''); }
  };
  const queryDate = statusDate || today;
  const status = useStatusDays(monthStart(queryDate), queryDate, rows.map((a) => a.id));
  const latest = useLatestStatusDays(rows.map((a) => a.id), queryDate);
  const proofStates = useEquipmentProofs(rows.map((a) => a.id), statusDate);
  const provenAssets = new Set((proofStates.data ?? []).filter((p) => p.proven).map((p) => p.asset_id));
  const flags = useDowntimeFlags();
  const flagged = new Set((flags.data ?? []).map((f) => f.asset_id));
  const lastStatus = useMemo(() => {
    const m = new Map<string, EquipmentStatus>();
    for (const s of latest.data ?? []) m.set(s.asset_id, s.status);
    return m;
  }, [latest.data]);
  const todays = useMemo(() => new Map((status.data ?? []).filter((s) => s.status_date === statusDate).map((s) => [s.asset_id, s.status])), [status.data, statusDate]);

  const [draft, setDraft] = useState<Record<string, EquipmentStatus>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const bulk = useSetStatusBulk();
  const proof = useAttachProof();

  const save = async () => {
    setProblem(null);
    const items = Object.entries(draft).map(([asset_id, st]) => ({ asset_id, status: st, ...(notes[asset_id]?.trim() ? { note: notes[asset_id].trim() } : {}) }));
    if (items.length === 0) return;
    try {
      await bulk.mutateAsync({ date: statusDate, items });
      setDraft({});
      setNotes({});
      setUploadedProofs((prior) => { const next = new Set(prior); for (const item of items) next.delete(`${item.asset_id}:${statusDate}`); return next; });
      toast(t('equipment:availability.saved', 'Status saved'), undefined, 'success');
    } catch (err) { setProblem(classifyMutationError(err).headline); }
  };
  const attach = async (assetId: string, file: File | undefined) => {
    if (!file) return;
    setProblem(null);
    try {
      await proof.mutateAsync({ assetId, date: statusDate, file });
      setUploadedProofs((prior) => new Set(prior).add(`${assetId}:${statusDate}`));
      toast(t('equipment:availability.proofSaved', 'Proof attached'), undefined, 'success');
    } catch (err) { setProblem(classifyMutationError(err).headline); }
  };

  const canMetrics = may('view', 'equipmentCosting');
  const [chosenMetricFrom, setMetricFrom] = useState<string | null>(null);
  const [chosenMetricTo, setMetricTo] = useState<string | null>(null);
  const metricFrom = chosenMetricFrom ?? monthFrom;
  const metricTo = chosenMetricTo ?? today;
  const [grain, setGrain] = useState<'day' | 'week' | 'month'>('month');
  const [metricAssets, setMetricAssets] = useState<string[]>([]);
  const [hours, setHours] = useState('');
  const workingHours = useEquipmentWorkingHours();
  const metrics = useEquipmentMetrics(metricAssets.length ? rows.filter((a) => metricAssets.includes(a.id)).map((a) => a.id) : rows.map((a) => a.id), metricFrom, metricTo, grain, canMetrics && rows.length > 0);
  const byAsset = new Map(rows.map((a) => [a.id, a]));
  const canTerms = may('manage', 'equipmentAvailability', writeCtx);
  const vendors = useCompanies('Vendor', { enabled: canTerms });
  const saveTerm = useRentalTerms();
  const saveOwnership = useEquipmentOwnership();
  const changeRate = useChangeRentalRate();
  const [inService, setInService] = useState('');
  const [termAsset, setTermAsset] = useState('');
  const terms = useRentalTermHistory(termAsset, canTerms);
  const [vendor, setVendor] = useState('');
  const [rate, setRate] = useState('');
  const [basis, setBasis] = useState<'day' | 'month'>('day');
  const [currency, setCurrency] = useState('IDR');
  const [rentedFrom, setRentedFrom] = useState('');
  const [rentedTo, setRentedTo] = useState('');
  const submitTerm = async () => {
    setProblem(null);
    try { await saveTerm.mutateAsync({ asset_id: termAsset, vendor_id: vendor, rate, basis, currency, rented_from: rentedFrom, rented_to: rentedTo || null }); toast(t('equipment:availability.saved', 'Status saved'), undefined, 'success'); }
    catch (err) { setProblem(classifyMutationError(err).headline); }
  };


  return (
    <ListPage title={t('equipment:availability.title', 'Availability')}>
      {canTerms && <nav aria-label={t('equipment:availability.views', 'Availability views')} className="mb-4 flex gap-2">
        <Button variant="outline" aria-pressed={view === 'status'} onClick={() => setView('status')}>{t('equipment:availability.statusHeading', 'Equipment status')}</Button>
        <Button variant="outline" aria-pressed={view === 'terms'} onClick={() => setView('terms')}>{t('equipment:availability.terms', 'Rental terms')}</Button>
      </nav>}
      {problem && <p role="alert" className="mb-3 text-sm text-destructive-text">{problem}</p>}
      {assets.isPending && <ListState variant="loading" shape="table" rows={4} />}
      {assets.isError && <ListState variant="error" title={t('equipment:availability.assetsError', "Couldn't load equipment")} onRetry={() => void assets.refetch()} />}
      {latest.isError && <p role="alert">{t('equipment:availability.latestError', 'Could not load last statuses')}</p>}
      {proofStates.isError && <p role="alert">{t('equipment:availability.proofsError', 'Could not load evidence status')}</p>}
      {status.isError && <p role="alert">{t('equipment:availability.statusError', 'Could not load statuses')}</p>}
      {!assets.isPending && !assets.isError && rows.length === 0 && (
        <ListState variant="empty" title={t('equipment:availability.empty', 'No equipment yet')}
          sub={t('equipment:availability.emptySub', 'Add assets under Equipment → Assets, then set their daily status here.')} />
      )}
      {view === 'status' && !assets.isError && !status.isError && rows.length > 0 && (
        <section aria-labelledby="eav-status-h" className="mb-6">
          <h2 id="eav-status-h" className="text-base font-semibold mb-2">{t('equipment:availability.statusHeading', 'Equipment status')}</h2>
          <div className="mb-3 max-w-xs"><TextField label={t('equipment:availability.statusDate', 'Status date')} type="date" value={statusDate} onChange={(v) => { setStatusDate(v); setDraft({}); setNotes({}); }} /></div>
          <ul className="divide-y divide-border rounded-md border border-border">
            {rows.map((a) => {
              const current = draft[a.id] ?? todays.get(a.id);
              const prev = lastStatus.get(a.id);
              const down = current ? isDownStatus(current) : false;
              return (
                <li key={a.id} className="flex flex-wrap items-center gap-3 p-3">
                  <span className="min-w-40 flex-1">
                    <span className="font-medium">{a.code}</span> <span className="text-muted-foreground">{a.name}</span>
                    {current && !may('create', 'equipmentAvailability', writeCtx) && <span className="ml-2">{statusLabel(t, current)}</span>}
                    {(uploadedProofs.has(`${a.id}:${statusDate}`) || (!proofStates.isFetching && provenAssets.has(a.id))) && down && !draft[a.id] && <Badge className="ml-2">{t('equipment:availability.proven', 'Proven')}</Badge>}
                    {flagged.has(a.id) && <span role="status" className="ml-2 text-destructive-text text-sm">{t('equipment:availability.flagged', 'Down more than 2 days')}</span>}
                    {!todays.has(a.id) && !draft[a.id] && <span className="ml-2 text-sm text-muted-foreground">{prev ? t('equipment:availability.last', 'Last: {{status}}', { status: statusLabel(t, prev) }) : t('equipment:availability.unrecorded', 'Not recorded')}</span>}
                  </span>
                  <CanWrite entity="equipmentAvailability" action="create" ctx={writeCtx}>
                    <SelectField hideLabel label={t('equipment:availability.statusFor', 'Status of {{code}}', { code: a.code })} value={current ?? ''}
                      onChange={(v) => setDraft((d) => ({ ...d, [a.id]: v as EquipmentStatus }))}
                      options={[{ value: '', label: t('equipment:availability.choose', 'Choose…') }, ...STATUSES.map((s) => ({ value: s, label: statusLabel(t, s) }))]} />
                    {draft[a.id] && <TextField label={t('equipment:availability.noteFor', 'Note for {{code}}', { code: a.code })} value={notes[a.id] ?? ''} onChange={(v) => setNotes((n) => ({ ...n, [a.id]: v }))} />}
                    {down && todays.has(a.id) && !draft[a.id] && (
                      <ProofUpload code={a.code} onFile={(file) => void attach(a.id, file)} />
                    )}
                  </CanWrite>
                </li>
              );
            })}
          </ul>
          <CanWrite entity="equipmentAvailability" action="create" ctx={writeCtx}>
            <Button variant="primary" className="mt-3" disabled={!statusDate || Object.keys(draft).length === 0 || bulk.isPending} onClick={() => void save()}>
              {t('equipment:availability.saveStatuses', 'Save statuses')}
            </Button>
          </CanWrite>
        </section>
      )}

      {(assetPage > 0 || assetPage + 1 < pages.length || assets.hasNextPage) && <div className="flex gap-2 mb-4">
        <Button variant="outline" disabled={assetPage === 0 || Object.keys(draft).length > 0} onClick={() => { setAssetPage(assetPage - 1); setMetricAssets([]); setTermAsset(''); }}>{t('equipment:availability.previousPage', 'Previous equipment page')}</Button>
        <Button variant="outline" disabled={(!assets.hasNextPage && assetPage + 1 >= pages.length) || Object.keys(draft).length > 0 || assets.isFetchingNextPage} onClick={() => void nextPage()}>{t('equipment:availability.nextPage', 'Next equipment page')}</Button>
      </div>}

      {view === 'status' && canMetrics && rows.length > 0 && (
        <section aria-labelledby="eav-metrics-h" className="mb-6">
          <h2 id="eav-metrics-h" className="text-base font-semibold mb-2">{t('equipment:availability.metricsHeading', 'This month')}</h2>
          <details className="mb-3">
            <summary>{t('equipment:availability.metricAssets', 'Assets for metrics')}</summary>
            <p className="text-sm text-muted-foreground">{t('equipment:availability.allWhenNone', 'Select none to show all on this page.')}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {rows.map((a) => <Checkbox key={a.id} label={`${a.code} ${a.name}`} checked={metricAssets.includes(a.id)} onChange={(checked) => setMetricAssets((selected) => checked ? [...selected, a.id] : selected.filter((id) => id !== a.id))} />)}
            </div>
          </details>
          <div className="grid gap-3 sm:grid-cols-3 mb-3">
            <SelectField label={t('equipment:availability.interval', 'Metric interval')} value={grain} onChange={(v) => setGrain(v as 'day' | 'week' | 'month')} options={[{ value: 'day', label: t('equipment:availability.day', 'Day') }, { value: 'week', label: t('equipment:availability.week', 'Week') }, { value: 'month', label: t('equipment:availability.month', 'Month') }]} />
            <TextField label={t('equipment:availability.metricFrom', 'Metric period from')} type="date" value={metricFrom} onChange={setMetricFrom} />
            <TextField label={t('equipment:availability.metricTo', 'Metric period to')} type="date" value={metricTo} onChange={setMetricTo} />
          </div>
          {realRole === 'Admin' && realRole === effectiveRole && <div className="mb-3 flex flex-wrap items-end gap-2">
            <TextField label={t('equipment:availability.workingHours', 'Working hours per day')} inputMode="decimal" value={hours} onChange={setHours} />
            <Button variant="outline" disabled={!hours || workingHours.isPending} onClick={() => { void workingHours.mutateAsync(hours).then(() => { setHours(''); toast(t('equipment:availability.hoursSaved', 'Working hours saved'), undefined, 'success'); }).catch((err: unknown) => setProblem(classifyMutationError(err).headline)); }}>{t('equipment:availability.saveHours', 'Save working hours')}</Button>
          </div>}
          {metrics.isError && <p role="alert">{t('equipment:availability.metricsError', 'Could not load metrics for this period.')}</p>}
          <table className="w-full text-sm">
            <thead><tr className="text-left">
              <th scope="col">{t('equipment:availability.asset', 'Asset')}</th>
              <th scope="col">{t('equipment:availability.period', 'Period')}</th>
              <th scope="col">{t('equipment:availability.availability', 'Availability')}</th>
              <th scope="col">{t('equipment:availability.utilisation', 'Utilisation')}</th>
              <th scope="col">{t('equipment:availability.unrecordedDays', 'Unrecorded days')}</th>
            </tr></thead>
            <tbody>{(metrics.data ?? []).map((m) => {
              const a = byAsset.get(m.asset_id);
              if (!a) return null;
              return (
                <tr key={`${a.id}-${m.bucket_start}`}>
                  <th scope="row" className="font-medium">{a.code}</th><td>{m.bucket_start}</td>
                  <td>{m?.availability_pct != null ? `${m.availability_pct}%` : '—'}</td>
                  <td>{m?.utilisation_pct != null ? `${m.utilisation_pct}%` : '—'}
                    {m && m.pending_usage_entries > 0 && <span className="ml-1 text-muted-foreground">{t('equipment:availability.pendingUsage', '({{n}} awaiting approval)', { n: m.pending_usage_entries })}</span>}</td>
                  <td>{m?.unrecorded_days ?? '—'}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </section>
      )}

      {view === 'terms' && canTerms && rows.length > 0 && (
        <section aria-labelledby="eav-terms-h" className="mb-6">
          <h2 id="eav-terms-h" className="text-base font-semibold mb-2">{t('equipment:availability.terms', 'Rental terms')}</h2>
          {terms.isError && <p role="alert">{t('equipment:availability.termsError', 'Could not load rental terms')}</p>}
          {(terms.data?.length ?? 0) > 0 && <ul className="mb-3">
            {terms.data?.map((term) => <li key={term.id}>{term.rented_from} – {term.rented_to ?? '…'} · {vendors.data?.find((v) => v.id === term.vendor_id)?.name ?? term.vendor_id} · {term.rate} {term.currency} / {term.basis === 'day' ? t('equipment:availability.day', 'Day') : t('equipment:availability.month', 'Month')}</li>)}
          </ul>}
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField label={t('equipment:availability.termAsset', 'Asset for rental terms')} value={termAsset} onChange={(v) => { setTermAsset(v); setVendor(''); setRate(''); setBasis('day'); setRentedFrom(''); setRentedTo(''); setInService((rows.find((a) => a.id === v) as { in_service_on?: string | null } | undefined)?.in_service_on ?? ''); }} options={[{ value: '', label: t('equipment:availability.choose', 'Choose…') }, ...rows.map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))]} />
            <SelectField label={t('equipment:availability.vendor', 'Vendor')} value={vendor} onChange={setVendor} options={[{ value: '', label: t('equipment:availability.choose', 'Choose…') }, ...(vendors.data ?? []).map((v) => ({ value: v.id, label: v.name }))]} />
            <TextField label={t('equipment:availability.rate', 'Rate')} value={rate} onChange={setRate} inputMode="decimal" />
            <SelectField label={t('equipment:availability.basis', 'Rate basis')} value={basis} onChange={(v) => setBasis(v as 'day' | 'month')} options={[{ value: 'day', label: t('equipment:availability.day', 'Day') }, { value: 'month', label: t('equipment:availability.month', 'Month') }]} />
            <TextField label={t('equipment:availability.currency', 'Currency')} value={currency} onChange={setCurrency} />
            <TextField label={t('equipment:availability.rentedFrom', 'Rental start')} type="date" value={rentedFrom} onChange={setRentedFrom} />
            <TextField label={t('equipment:availability.inService', 'In service from (optional)')} type="date" value={inService} onChange={setInService} />
            <TextField label={t('equipment:availability.rentedTo', 'Rental end (optional)')} type="date" value={rentedTo} onChange={setRentedTo} />
          </div>
          <Button variant="primary" className="mt-3" disabled={!termAsset || !vendor || !rate || !rentedFrom || saveTerm.isPending} onClick={() => void submitTerm()}>{t('equipment:availability.saveTerms', 'Save rental terms')}</Button>
          <details className="mt-3"><summary>{t('equipment:availability.otherAssetActions', 'Other asset actions')}</summary>
          <Button variant="outline" className="mt-3 ml-2" disabled={!termAsset || saveOwnership.isPending} onClick={() => { const a = rows.find((row) => row.id === termAsset) as { ownership?: string } | undefined; void saveOwnership.mutateAsync({ assetId: termAsset, ownership: a?.ownership === 'rented' ? 'rented' : 'owned', inServiceOn: inService || null }).then(() => toast(t('equipment:availability.inServiceSaved', 'In-service date saved'), undefined, 'success')).catch((err: unknown) => setProblem(classifyMutationError(err).headline)); }}>{t('equipment:availability.saveInService', 'Save in-service date')}</Button>
          <Button variant="outline" className="mt-3 ml-2" disabled={!termAsset || saveOwnership.isPending} onClick={() => { setProblem(null); void saveOwnership.mutateAsync({ assetId: termAsset, ownership: 'owned', inServiceOn: inService || null }).then(() => toast(t('equipment:availability.ownershipSaved', 'Ownership saved'), undefined, 'success')).catch((err: unknown) => setProblem(classifyMutationError(err).headline)); }}>{t('equipment:availability.markOwned', 'Mark owned')}</Button>
          <Button variant="outline" className="mt-3 ml-2" disabled={!termAsset || !rate || !rentedFrom || changeRate.isPending} onClick={() => { setProblem(null); void changeRate.mutateAsync({ assetId: termAsset, date: rentedFrom, rate }).then(() => toast(t('equipment:availability.rateChanged', 'Rate changed'), undefined, 'success')).catch((err: unknown) => setProblem(classifyMutationError(err).headline)); }}>{t('equipment:availability.changeRate', 'Change rate from date')}</Button>
          </details>
        </section>
      )}


      {may('approve', 'equipmentAvailability', writeCtx) && <RentalInvoiceCheck assets={rows.filter((a) => (a as { ownership?: string }).ownership === 'rented')} today={today} monthFrom={monthFrom} statusLabel={(value) => statusLabel(t, value)} />}
    </ListPage>
  );
};
export default EquipmentAvailabilityPage;
