import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DateField } from '@/src/components/ui/DateField';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { FileInput } from '@/src/components/ui/FormFields';
import { FileCell } from '@/src/components/FileCell';
import { Button, SelectField, StatusPill, TextField, useToast } from '@/src/components/ui';
import { CanWrite, usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import {
  useAttachProof, useDowntimeFlags, useEquipmentProofs, useLatestStatusDays, useSetStatusBulk, useStatusDays,
} from '@/src/hooks/useEquipmentAvailability';
import { useOrgToday } from '@/src/hooks/useOrgToday';
import { useOrgBusinessTimezone } from '@/src/hooks/useResolvedLocale';
import { useEquipmentTargetValues } from '@/src/hooks/useEquipmentTargets';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { isDownStatus, type EquipmentStatus } from '@/src/lib/equipmentMetrics';
import type { EquipmentAssetRow } from '@/src/lib/db/equipment';
import { monthStart } from './equipmentWeek';

export const STATUSES: EquipmentStatus[] = ['ready', 'standby', 'broken', 'at_vendor', 'waiting_parts'];

/** Static t() calls so the catalogue gates see every key (the pattern of `equipmentLabels`). */
export function statusLabel(t: ReturnType<typeof useTranslation>['t'], s: EquipmentStatus): string {
  switch (s) {
    case 'ready': return t('equipment:availability.status.ready', 'Ready');
    case 'standby': return t('equipment:availability.status.standby', 'Standby');
    case 'broken': return t('equipment:availability.status.broken', 'Broken');
    case 'at_vendor': return t('equipment:availability.status.at_vendor', 'At vendor');
    case 'waiting_parts': return t('equipment:availability.status.waiting_parts', 'Waiting for parts');
  }
}

/** One line per status saying what it does to planning (the 2526 rules: only the three down statuses leave availability). */
export function statusEffect(t: ReturnType<typeof useTranslation>['t'], s: EquipmentStatus): string {
  switch (s) {
    case 'ready': return t('equipment:availability.effect.ready', 'Counts as available. Plan it for work.');
    case 'standby': return t('equipment:availability.effect.standby', 'Counts as available, not working. Plan it as spare.');
    case 'broken': return t('equipment:availability.effect.broken', 'Not available. Leave it out of plans; counts as downtime.');
    case 'at_vendor': return t('equipment:availability.effect.at_vendor', 'Not available while it is at the vendor. Counts as downtime.');
    case 'waiting_parts': return t('equipment:availability.effect.waiting_parts', 'Not available until the parts arrive. Counts as downtime.');
  }
}

function ProofUpload({ code, onFile }: { code: string; onFile: (file: File | undefined) => void }) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  return <span className="[&_button]:text-control [&_svg]:size-4">
    <FileCell status="Draft" filePath={null} title={code} onUpload={() => input.current?.click()} />
    <FileInput ref={input} tabIndex={-1} className="sr-only" aria-label={t('equipment:availability.proofFor', 'Attach proof for {{code}}', { code })} accept="image/*,application/pdf" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; onFile(file); }} />
  </span>;
}

type Props = {
  rows: EquipmentAssetRow[];
  /** The status date is fixed to today unless the screen lets the person pick a day. */
  allowDate?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onProblem: (message: string | null) => void;
};

/**
 * The machines and their status for a day, with a status, a note and the proof photo set in ONE step (camera first on a
 * phone). Used by the Equipment home and by Availability. UX only: `set_equipment_status_bulk` and the proof RPC enforce.
 */
export const MachineStatusSection: React.FC<Props> = ({ rows, allowDate = false, onDirtyChange, onProblem }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  const writeCtx = { record: { viewOnly: realRole !== effectiveRole } };
  const timezone = useOrgBusinessTimezone();
  const today = useOrgToday(timezone);
  const [chosenStatusDate, setStatusDate] = useState<string | null>(null);
  const statusDate = chosenStatusDate ?? today;
  const queryDate = statusDate || today;
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, File | undefined>>({});
  const [draft, setDraft] = useState<Record<string, EquipmentStatus>>({});
  const [uploadedProofs, setUploadedProofs] = useState<Set<string>>(() => new Set());
  const [justBroken, setJustBroken] = useState<string[]>([]);
  const ids = rows.map((a) => a.id);
  const status = useStatusDays(monthStart(queryDate), queryDate, ids);
  const latest = useLatestStatusDays(ids, queryDate);
  const proofStates = useEquipmentProofs(ids, statusDate);
  const provenAssets = new Set((proofStates.data ?? []).filter((p) => p.proven).map((p) => p.asset_id));
  const flags = useDowntimeFlags();
  const flagged = new Set((flags.data ?? []).map((f) => f.asset_id));
  const { escalation_down_days: escalationLimit } = useEquipmentTargetValues();
  const lastStatus = useMemo(() => {
    const m = new Map<string, EquipmentStatus>();
    for (const s of latest.data ?? []) m.set(s.asset_id, s.status);
    return m;
  }, [latest.data]);
  const todays = useMemo(() => new Map((status.data ?? []).filter((s) => s.status_date === statusDate).map((s) => [s.asset_id, s.status])), [status.data, statusDate]);
  const bulk = useSetStatusBulk();
  const proof = useAttachProof();
  const dirty = Object.keys(draft).length > 0;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  const reset = () => { setDraft({}); setNotes({}); setFiles({}); };

  const save = async () => {
    onProblem(null);
    const items = Object.entries(draft).map(([asset_id, st]) => ({ asset_id, status: st, ...(notes[asset_id]?.trim() ? { note: notes[asset_id].trim() } : {}) }));
    if (items.length === 0) return;
    try {
      await bulk.mutateAsync({ date: statusDate, items });
    } catch (err) { onProblem(classifyMutationError(err).headline); return; }
    // The proof goes up with the status: a photo that fails to upload does not undo the saved status.
    const failedProofs: string[] = [];
    for (const item of items) {
      const file = files[item.asset_id];
      if (!file || !isDownStatus(item.status)) continue;
      try {
        await proof.mutateAsync({ assetId: item.asset_id, date: statusDate, file, ...(item.note ? { note: item.note } : {}) });
        setUploadedProofs((prior) => new Set(prior).add(`${item.asset_id}:${statusDate}`));
      } catch { failedProofs.push(rows.find((a) => a.id === item.asset_id)?.code ?? item.asset_id); }
    }
    setJustBroken(items.filter((i) => i.status === 'broken').map((i) => rows.find((a) => a.id === i.asset_id)?.code ?? i.asset_id));
    reset();
    toast(t('equipment:availability.saved', 'Status saved'), undefined, 'success');
    if (failedProofs.length > 0) {
      onProblem(t('equipment:availability.proofFailed', 'Status saved, but the photo for {{codes}} did not upload. Attach it again from the row.', { codes: failedProofs.join(', ') }));
    }
  };
  const attach = async (assetId: string, file: File | undefined) => {
    if (!file) return;
    onProblem(null);
    try {
      await proof.mutateAsync({ assetId, date: statusDate, file });
      setUploadedProofs((prior) => new Set(prior).add(`${assetId}:${statusDate}`));
      toast(t('equipment:availability.proofSaved', 'Proof attached'), undefined, 'success');
    } catch (err) { onProblem(classifyMutationError(err).headline); }
  };

  if (status.isError) return <p role="alert">{t('equipment:availability.statusError', 'Could not load statuses')}</p>;
  const canSet = may('create', 'equipmentAvailability', writeCtx);
  return (
    <section aria-labelledby="eav-status-h" className="mb-6">
      <h2 id="eav-status-h" className="text-base font-semibold mb-2">{t('equipment:availability.statusHeading', 'Equipment status')}</h2>
      {latest.isError && <p role="alert">{t('equipment:availability.latestError', 'Could not load last statuses')}</p>}
      {proofStates.isError && <p role="alert">{t('equipment:availability.proofsError', 'Could not load evidence status')}</p>}
      {allowDate
        ? <div className="mb-3 max-w-xs"><DateField label={t('equipment:availability.statusDate', 'Status date')} value={statusDate} onChange={(v) => { setStatusDate(v); reset(); }} /></div>
        : <p className="mb-3 text-sm text-muted-foreground">{t('equipment:availability.statusToday', 'Status for today. Pick a different day under Availability.')}</p>}
      {justBroken.length > 0 && <p role="status" className="mb-3 rounded-card border border-border p-3 text-sm">
        {t('equipment:availability.notifiedBroken', 'Marked broken: {{codes}}. Nobody is messaged right away. Admin and Project Manager users are told if it stays down more than {{n}} days; the machine shows as down on this page now.', { codes: justBroken.join(', '), n: escalationLimit })}
      </p>}
      <ul className="divide-y divide-border rounded-md border border-border">
        {rows.map((a) => {
          const current = draft[a.id] ?? todays.get(a.id);
          const prev = lastStatus.get(a.id);
          const down = current ? isDownStatus(current) : false;
          return (
            <li key={a.id} className="flex flex-wrap items-center gap-3 p-3">
              <span className="min-w-40 flex-1">
                <Link to={`/equipment/assets/${a.id}`} className="touch-target inline-flex items-center font-medium text-primary-text hover:underline">{a.code}</Link> <span className="text-muted-foreground">{a.name}</span>
                {current && <span className="ml-2" data-testid={`today-status-${a.code}`}>{statusLabel(t, current)}</span>}
                {(uploadedProofs.has(`${a.id}:${statusDate}`) || (!proofStates.isFetching && provenAssets.has(a.id))) && down && !draft[a.id] && <StatusPill variant="won" className="ml-2">{t('equipment:availability.proven', 'Proven')}</StatusPill>}
                {down && todays.has(a.id) && !draft[a.id] && proofStates.data && !proofStates.isFetching && !proofStates.isError && !uploadedProofs.has(`${a.id}:${statusDate}`) && !provenAssets.has(a.id) && <StatusPill variant="warn" className="ml-2">{t('equipment:availability.noProof', 'No proof')}</StatusPill>}
                {flagged.has(a.id) && <span role="status" className="ml-2 text-destructive-text text-sm">{t('equipment:availability.flagged', 'Down more than {{n}} days', { n: escalationLimit })}</span>}
                {!todays.has(a.id) && !draft[a.id] && <span className="ml-2 text-sm text-muted-foreground">{prev ? t('equipment:availability.last', 'Last: {{status}}', { status: statusLabel(t, prev) }) : t('equipment:availability.unrecorded', 'Not recorded')}</span>}
              </span>
              <CanWrite entity="equipmentAvailability" action="create" ctx={writeCtx}>
                <SelectField hideLabel label={t('equipment:availability.statusFor', 'Status of {{code}}', { code: a.code })} value={current ?? ''}
                  onChange={(v) => setDraft((d) => ({ ...d, [a.id]: v as EquipmentStatus }))}
                  options={[{ value: '', label: t('equipment:availability.choose', 'Choose…') }, ...STATUSES.map((s) => ({ value: s, label: statusLabel(t, s) }))]} />
                {draft[a.id] && <TextField label={t('equipment:availability.noteFor', 'Note for {{code}}', { code: a.code })} value={notes[a.id] ?? ''} onChange={(v) => setNotes((n) => ({ ...n, [a.id]: v }))} />}
                {draft[a.id] && <p className="basis-full text-sm text-muted-foreground">{statusEffect(t, draft[a.id])}</p>}
                {draft[a.id] && isDownStatus(draft[a.id]) && (
                  <label className="basis-full text-sm">
                    <span className="mr-2">{t('equipment:availability.photoFor', 'Photo or document for {{code}} (optional)', { code: a.code })}</span>
                    <FileInput accept="image/*,application/pdf" capture="environment" aria-label={t('equipment:availability.photoInputFor', 'Photo for {{code}}', { code: a.code })}
                      onChange={(e) => { const file = e.target.files?.[0]; setFiles((prior) => ({ ...prior, [a.id]: file })); }} />
                    {files[a.id] && <span className="ml-2 text-muted-foreground">{files[a.id]!.name}</span>}
                  </label>
                )}
                {down && todays.has(a.id) && !draft[a.id] && (
                  <ProofUpload code={a.code} onFile={(file) => void attach(a.id, file)} />
                )}
              </CanWrite>
            </li>
          );
        })}
      </ul>
      {canSet && <Button variant="primary" className="mt-3" disabled={!statusDate || !dirty || bulk.isPending || proof.isPending} onClick={() => void save()}>
        {t('equipment:availability.saveStatuses', 'Save statuses')}
      </Button>}
    </section>
  );
};
