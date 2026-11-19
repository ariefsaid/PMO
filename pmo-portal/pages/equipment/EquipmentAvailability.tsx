import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileInput } from '@/src/components/ui/FormFields';
import { Button, ListPage, ListState, SelectField, TextField, useToast } from '@/src/components/ui';
import { CanWrite, usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useEquipmentAssetPages } from '@/src/hooks/useEquipment';
import {
  useAttachProof, useDowntimeFlags, useEquipmentMetrics, useRentalCheck, useSetStatusBulk, useStatusDays,
} from '@/src/hooks/useEquipmentAvailability';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { isDownStatus, type EquipmentStatus } from '@/src/lib/equipmentMetrics';
import { monthStart, toIso } from './equipmentWeek';

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

/** Equipment → Availability (#2526): set today's status for every machine (phone-first), see availability and utilisation,
 *  and — for Finance — check a rented machine's downtime deduction against the vendor invoice. UX only; the RPCs enforce. */
const EquipmentAvailabilityPage: React.FC = () => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  const writeCtx = { record: { viewOnly: realRole !== effectiveRole } };
  const today = toIso(new Date());
  const monthFrom = monthStart(today);

  const assets = useEquipmentAssetPages();
  const rows = (assets.data?.pages ?? []).flatMap((p) => p.rows);
  const status = useStatusDays(monthFrom, today);
  const flags = useDowntimeFlags();
  const flagged = new Set((flags.data ?? []).map((f) => f.asset_id));
  const lastStatus = useMemo(() => {
    const m = new Map<string, EquipmentStatus>();
    for (const s of status.data ?? []) m.set(s.asset_id, s.status);   // ordered by date: the last write wins
    return m;
  }, [status.data]);
  const todays = useMemo(() => new Map((status.data ?? []).filter((s) => s.status_date === today).map((s) => [s.asset_id, s.status])), [status.data, today]);

  const [draft, setDraft] = useState<Record<string, EquipmentStatus>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const bulk = useSetStatusBulk();
  const proof = useAttachProof();

  const save = async () => {
    setProblem(null);
    const items = Object.entries(draft).map(([asset_id, st]) => ({ asset_id, status: st }));
    if (items.length === 0) return;
    try {
      await bulk.mutateAsync({ date: today, items });
      setDraft({});
      toast(t('equipment:availability.saved', 'Status saved'), undefined, 'success');
    } catch (err) { setProblem(classifyMutationError(err).headline); }
  };
  const attach = async (assetId: string, file: File | undefined) => {
    if (!file) return;
    setProblem(null);
    try {
      await proof.mutateAsync({ assetId, date: today, file });
      toast(t('equipment:availability.proofSaved', 'Proof attached'), undefined, 'success');
    } catch (err) { setProblem(classifyMutationError(err).headline); }
  };

  const canMetrics = may('view', 'equipmentCosting');
  const metrics = useEquipmentMetrics(rows.slice(0, 200).map((a) => a.id), monthFrom, today, 'month', canMetrics && rows.length > 0);
  const byAsset = new Map((metrics.data ?? []).map((m) => [m.asset_id, m]));

  const canCheck = may('approve', 'equipmentAvailability', writeCtx);
  const rented = rows.filter((a) => (a as { ownership?: string }).ownership === 'rented');
  const [checkAsset, setCheckAsset] = useState('');
  const [from, setFrom] = useState(monthFrom);
  const [to, setTo] = useState(today);
  const [invoice, setInvoice] = useState('');
  const [reason, setReason] = useState('');
  const check = useRentalCheck();
  const runCheck = async (withReason: boolean) => {
    setProblem(null);
    try { await check.mutateAsync({ assetId: checkAsset, from, to, invoice, reason: withReason ? reason : undefined }); }
    catch (err) { setProblem(classifyMutationError(err).headline); }
  };
  const result = check.data;

  return (
    <ListPage title={t('equipment:availability.title', 'Availability')}>
      {problem && <p role="alert" className="mb-3 text-sm text-destructive-text">{problem}</p>}
      {assets.isPending && <ListState variant="loading" shape="table" rows={4} />}
      {!assets.isPending && rows.length === 0 && (
        <ListState variant="empty" title={t('equipment:availability.empty', 'No equipment yet')}
          sub={t('equipment:availability.emptySub', 'Add assets under Equipment → Assets, then set their daily status here.')} />
      )}
      {rows.length > 0 && (
        <section aria-labelledby="eav-status-h" className="mb-6">
          <h2 id="eav-status-h" className="text-base font-semibold mb-2">{t('equipment:availability.todayHeading', "Today's status")}</h2>
          <ul className="divide-y divide-border rounded-md border border-border">
            {rows.map((a) => {
              const current = draft[a.id] ?? todays.get(a.id);
              const prev = lastStatus.get(a.id);
              const down = current ? isDownStatus(current) : false;
              return (
                <li key={a.id} className="flex flex-wrap items-center gap-3 p-3">
                  <span className="min-w-40 flex-1">
                    <span className="font-medium">{a.code}</span> <span className="text-muted-foreground">{a.name}</span>
                    {flagged.has(a.id) && <span role="status" className="ml-2 text-destructive-text text-sm">{t('equipment:availability.flagged', 'Down more than 2 days')}</span>}
                    {!todays.has(a.id) && !draft[a.id] && <span className="ml-2 text-sm text-muted-foreground">{prev ? t('equipment:availability.last', 'Last: {{status}}', { status: statusLabel(t, prev) }) : t('equipment:availability.unrecorded', 'Not recorded')}</span>}
                  </span>
                  <CanWrite entity="equipmentAvailability" action="create" ctx={writeCtx}>
                    <SelectField label={t('equipment:availability.statusFor', 'Status of {{code}}', { code: a.code })} value={current ?? ''}
                      onChange={(v) => setDraft((d) => ({ ...d, [a.id]: v as EquipmentStatus }))}
                      options={[{ value: '', label: t('equipment:availability.choose', 'Choose…') }, ...STATUSES.map((s) => ({ value: s, label: statusLabel(t, s) }))]} />
                    {down && todays.has(a.id) && !draft[a.id] && (
                      <label className="text-sm">
                        <span className="sr-only">{t('equipment:availability.proofFor', 'Attach proof for {{code}}', { code: a.code })}</span>
                        <FileInput accept="image/*,application/pdf" onChange={(e) => void attach(a.id, e.target.files?.[0])} />
                      </label>
                    )}
                  </CanWrite>
                </li>
              );
            })}
          </ul>
          <CanWrite entity="equipmentAvailability" action="create" ctx={writeCtx}>
            <Button variant="primary" className="mt-3" disabled={Object.keys(draft).length === 0 || bulk.isPending} onClick={() => void save()}>
              {t('equipment:availability.save', "Save today's status")}
            </Button>
          </CanWrite>
        </section>
      )}

      {canMetrics && rows.length > 0 && (
        <section aria-labelledby="eav-metrics-h" className="mb-6">
          <h2 id="eav-metrics-h" className="text-base font-semibold mb-2">{t('equipment:availability.metricsHeading', 'This month')}</h2>
          <table className="w-full text-sm">
            <thead><tr className="text-left">
              <th scope="col">{t('equipment:availability.asset', 'Asset')}</th>
              <th scope="col">{t('equipment:availability.availability', 'Availability')}</th>
              <th scope="col">{t('equipment:availability.utilisation', 'Utilisation')}</th>
              <th scope="col">{t('equipment:availability.unrecordedDays', 'Unrecorded days')}</th>
            </tr></thead>
            <tbody>{rows.map((a) => {
              const m = byAsset.get(a.id);
              return (
                <tr key={a.id}>
                  <th scope="row" className="font-medium">{a.code}</th>
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

      {canCheck && rented.length > 0 && (
        <section aria-labelledby="eav-check-h">
          <h2 id="eav-check-h" className="text-base font-semibold mb-2">{t('equipment:availability.checkHeading', 'Rental invoice check')}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField label={t('equipment:availability.rentedAsset', 'Rented machine')} value={checkAsset} onChange={setCheckAsset}
              options={[{ value: '', label: t('equipment:availability.choose', 'Choose…') }, ...rented.map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))]} />
            <TextField label={t('equipment:availability.from', 'Invoice period from')} type="date" value={from} onChange={setFrom} />
            <TextField label={t('equipment:availability.to', 'Invoice period to')} type="date" value={to} onChange={setTo} />
            <TextField label={t('equipment:availability.invoiceAmount', 'Vendor invoice amount')} inputMode="decimal" value={invoice} onChange={setInvoice} />
          </div>
          <Button variant="primary" className="mt-3" disabled={!checkAsset || check.isPending} onClick={() => void runCheck(false)}>{t('equipment:availability.runCheck', 'Check invoice')}</Button>
          {result && (
            <div className="mt-4" role="region" aria-label={t('equipment:availability.result', 'Check result')}>
              <dl className="grid grid-cols-2 gap-1 text-sm max-w-md">
                <dt>{t('equipment:availability.rentalAmount', 'Rental amount')}</dt><dd className="text-right tabular-nums">{result.rentalAmount} {result.currency}</dd>
                <dt>{t('equipment:availability.deduction', 'Downtime deduction')}</dt><dd className="text-right tabular-nums">{result.deduction}</dd>
                <dt>{t('equipment:availability.expected', 'Expected invoice')}</dt><dd className="text-right tabular-nums">{result.expectedAmount}</dd>
                {result.difference != null && (<><dt>{t('equipment:availability.difference', 'Invoice minus expected')}</dt><dd className="text-right tabular-nums">{result.difference}</dd></>)}
              </dl>
              <h3 className="mt-3 text-sm font-semibold">{t('equipment:availability.days', 'Down days')}</h3>
              <ul className="text-sm">{result.days.map((d) => (
                <li key={d.date}>{d.date} · {statusLabel(t, d.status)} · {d.proven ? t('equipment:availability.proven', 'Proven') : t('equipment:availability.unproven', 'Unproven — not deducted')}
                  {d.proofs.map((p) => <span key={p.id} className="ml-2">{p.file_name}</span>)}</li>
              ))}</ul>
              {result.unproven_days.length > 0 && !result.included_unproven_reason && (
                <div className="mt-3">
                  <TextField label={t('equipment:availability.reason', 'Reason to include unproven days')} value={reason} onChange={setReason} />
                  <Button variant="outline" className="mt-2" disabled={!reason.trim()} onClick={() => void runCheck(true)}>{t('equipment:availability.include', 'Include unproven days')}</Button>
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </ListPage>
  );
};
export default EquipmentAvailabilityPage;
