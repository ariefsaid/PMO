import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DateField } from '@/src/components/ui/DateField';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { FileInput } from '@/src/components/ui/FormFields';
import { FileCell } from '@/src/components/FileCell';
import { Button, DataTable, RecordSection, SelectField, StatusPill, TextField, useToast, type Column } from '@/src/components/ui';
import { formatDay } from '@/src/lib/format';
import { usePermission } from '@/src/auth/usePermission';
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
import { statusEffect, statusLabel, STATUSES } from './equipmentStatusLabels';

/**
 * The status write's refusals (1032 `equipment_set_status_core`) carry no refusal code, so they are read by their sentence.
 * ponytail: matched on the database's wording; move to coded refusals (`src/lib/refusals.ts`) when that function is next restated.
 */
const STATUS_REFUSALS: Array<[RegExp, string, string]> = [
  [/precedes the asset's in-service date/, 'equipment:availability.refusal.beforeInService', 'This date is before the machine went into service. Pick a date on or after its in-service date.'],
  [/status date is in the future/, 'equipment:availability.refusal.future', 'The status date cannot be in the future.'],
  [/note is at most 500 characters/, 'equipment:availability.refusal.noteLength', 'Keep the note to 500 characters or fewer.'],
  [/status must be ready, standby/, 'equipment:availability.refusal.status', 'Choose one of the listed statuses.'],
  [/asset not found/, 'equipment:availability.refusal.assetGone', 'One of these machines is no longer available. Reload the page.'],
];

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
    } catch (err) {
      const message = (err as { message?: unknown } | null)?.message;
      const known = typeof message === 'string' ? STATUS_REFUSALS.find(([re]) => re.test(message)) : undefined;
      onProblem(known ? t(known[1], known[2]) : classifyMutationError(err).headline);
      return;
    }
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
  const proven = (a: EquipmentAssetRow) => uploadedProofs.has(`${a.id}:${statusDate}`) || (!proofStates.isFetching && provenAssets.has(a.id));
  const columns: Column<EquipmentAssetRow>[] = [
    { key: 'machine', header: t('equipment:availability.machine', 'Machine'), kind: 'primary', rowHeader: true,
      cell: (a) => <Link to={`/equipment/assets/${a.id}`} className="touch-target inline-flex items-center font-medium text-primary-text hover:underline">{a.code}</Link>,
      secondaryCell: (a) => a.name },
    // What is on record for the day: the saved status, else the last one before it, else nothing yet.
    { key: 'recorded', header: t('equipment:availability.recorded', 'Recorded'), keepWhenBlank: true,
      cell: (a) => {
        const saved = todays.get(a.id);
        if (saved) return <span data-testid={`today-status-${a.code}`}>{statusLabel(t, saved)}</span>;
        const prev = lastStatus.get(a.id);
        return <span className="text-muted-foreground">{prev ? t('equipment:availability.last', 'Last: {{status}}', { status: statusLabel(t, prev) }) : t('equipment:availability.unrecorded', 'Not recorded')}</span>;
      } },
    { key: 'proof', header: t('equipment:availability.proof', 'Proof'),
      cell: (a) => {
        const saved = todays.get(a.id);
        if (!saved || !isDownStatus(saved) || draft[a.id]) return null;
        if (proven(a)) return <StatusPill variant="won">{t('equipment:availability.proven', 'Proven')}</StatusPill>;
        return <span className="inline-flex items-center gap-2">
          {proofStates.data && !proofStates.isFetching && !proofStates.isError && <StatusPill variant="warn">{t('equipment:availability.noProof', 'No proof')}</StatusPill>}
          {canSet && <ProofUpload code={a.code} onFile={(file) => void attach(a.id, file)} />}
        </span>;
      } },
    { key: 'flag', header: t('equipment:availability.downLong', 'Escalation'),
      cell: (a) => flagged.has(a.id) ? <span role="status" className="text-destructive-text">{t('equipment:availability.flagged', 'Down more than {{n}} days', { n: escalationLimit })}</span> : null },
    ...(canSet ? [{ key: 'set', header: t('equipment:availability.setStatus', 'Set status'),
      cell: (a: EquipmentAssetRow) => {
        const current = draft[a.id] ?? todays.get(a.id);
        return <div className="flex min-w-56 flex-col gap-2">
          <SelectField hideLabel label={t('equipment:availability.statusFor', 'Status of {{code}}', { code: a.code })} value={current ?? ''}
            onChange={(v) => setDraft((d) => ({ ...d, [a.id]: v as EquipmentStatus }))}
            options={[{ value: '', label: t('equipment:availability.choose', 'Choose…') }, ...STATUSES.map((st) => ({ value: st, label: statusLabel(t, st) }))]} />
          {draft[a.id] && <>
            <p className="text-muted-foreground">{statusEffect(t, draft[a.id])}</p>
            <TextField label={t('equipment:availability.noteFor', 'Note for {{code}}', { code: a.code })} value={notes[a.id] ?? ''} onChange={(v) => setNotes((n) => ({ ...n, [a.id]: v }))} />
            {isDownStatus(draft[a.id]) && <label className="flex flex-col gap-1">
              <span>{t('equipment:availability.photoFor', 'Photo or document for {{code}} (optional)', { code: a.code })}</span>
              <FileInput accept="image/*,application/pdf" capture="environment" aria-label={t('equipment:availability.photoInputFor', 'Photo for {{code}}', { code: a.code })}
                onChange={(e) => { const file = e.target.files?.[0]; setFiles((prior) => ({ ...prior, [a.id]: file })); }} />
              {files[a.id] && <span className="text-muted-foreground">{files[a.id]!.name}</span>}
            </label>}
          </>}
        </div>;
      } }] : []),
  ];
  return (
    <RecordSection headingId="eav-status-h" title={t('equipment:availability.statusHeading', 'Equipment status')} flush
      actions={<>
        {!allowDate && <span className="text-muted-foreground">{formatDay(statusDate)}</span>}
        {canSet && <Button variant="primary" disabled={!statusDate || !dirty || bulk.isPending || proof.isPending} onClick={() => void save()}>
          {t('equipment:availability.saveStatuses', 'Save statuses')}
        </Button>}
      </>}>
      {allowDate && <div className="px-[var(--panel-inset)] pb-4"><div className="w-44"><DateField label={t('equipment:availability.statusDate', 'Status date')} value={statusDate} onChange={(v) => { setStatusDate(v); reset(); }} /></div></div>}
      {(latest.isError || proofStates.isError || justBroken.length > 0) && <div className="flex flex-col gap-2 px-[var(--panel-inset)] pb-3">
        {latest.isError && <p role="alert">{t('equipment:availability.latestError', 'Could not load last statuses')}</p>}
        {proofStates.isError && <p role="alert">{t('equipment:availability.proofsError', 'Could not load evidence status')}</p>}
        {justBroken.length > 0 && <p role="status" className="rounded-card bg-waiting-surface p-3">
          {t('equipment:availability.notifiedBroken', 'Marked broken: {{codes}}. Nobody is messaged right away. Admin and Project Manager users are told if it stays down more than {{n}} days; the machine shows as down on this page now.', { codes: justBroken.join(', '), n: escalationLimit })}
        </p>}
      </div>}
      <DataTable<EquipmentAssetRow> embedded rows={rows} columns={columns} rowKey={(a) => a.id} tableId="equipment-status"
        accessibleName={t('equipment:availability.statusHeading', 'Equipment status')} />
    </RecordSection>
  );
};
