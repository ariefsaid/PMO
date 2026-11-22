import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, DateField, SelectField, TextField, useToast, StatusPill } from '@/src/components/ui';
import { FileInput } from '@/src/components/ui/FormFields';
import { useAssignableProfiles } from '@/src/hooks/useTasks';
import { useCandidateMutations } from '@/src/hooks/useWorkOrderCandidates';
import { repositories } from '@/src/lib/repositories';
import type { AssessmentStatus } from '@/src/lib/candidateAssessment';
import type { CandidateItem, WorkOrderCandidate } from '@/src/lib/db/workOrderCandidates';
import { refusalLine, useRefusalText } from '@/src/lib/refusals';

/**
 * #2595 (FR-CWO-003/004/005): one candidate's assessment checklist: each item has an owner, a target date, a status, a note
 * and proof files. Read-only once the candidate is decided or when the viewer cannot assess. The database is the authority
 * (RLS on the items); `canEdit` only decides whether the controls are drawn.
 */
const STATUSES: AssessmentStatus[] = ['open', 'passed', 'failed', 'not_applicable'];
const ACCEPT = 'image/png,image/jpeg,image/webp,application/pdf';

export const CandidateChecklist: React.FC<{
  candidate: WorkOrderCandidate;
  canEdit: boolean;
  today: string;
  projectId: string;
}> = ({ candidate, canEdit, today, projectId }) => {
  const { t } = useTranslation('project');
  const refusal = useRefusalText();
  const { toast } = useToast();
  const m = useCandidateMutations(projectId);
  const profiles = useAssignableProfiles({ enabled: canEdit });
  const [adding, setAdding] = useState('');
  const editable = canEdit && candidate.status === 'assessing';

  const statusLabel: Record<AssessmentStatus, string> = {
    open: t('projectDetail.candidates.status.open', 'Open'),
    passed: t('projectDetail.candidates.status.passed', 'Passed'),
    failed: t('projectDetail.candidates.status.failed', 'Failed'),
    not_applicable: t('projectDetail.candidates.status.notApplicable', 'Not applicable'),
  };
  const run = async (work: () => Promise<unknown>) => {
    try { await work(); } catch (err) { toast(refusalLine(refusal(err)), undefined, 'warning'); }
  };

  if (candidate.items.length === 0 && !editable) {
    return <p className="text-control text-muted-foreground">{t('projectDetail.candidates.noItems', 'This candidate has no checklist items.')}</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <ul className="divide-y divide-border" aria-label={t('projectDetail.candidates.checklist', 'Assessment checklist')}>
        {candidate.items.map((item) => (
          <ItemRow key={item.id} item={item} candidate={candidate} editable={editable} today={today} statusLabel={statusLabel}
            owners={(profiles.data ?? []).filter((p) => p.status === 'active').map((p) => ({ value: p.id, label: p.full_name ?? p.email ?? p.id }))}
            onPatch={(patch) => run(() => m.updateItem.mutateAsync({ itemId: item.id, patch }))}
            onUpload={(file) => run(() => m.uploadProof.mutateAsync({ candidate, itemId: item.id, file }))}
            onRemoveProof={(proofId) => run(() => m.archiveProof.mutateAsync(proofId))} />
        ))}
      </ul>
      {editable && (
        <form className="flex items-end gap-2" onSubmit={(e) => {
          e.preventDefault();
          if (!adding.trim()) return;
          void run(async () => { await m.addItem.mutateAsync({ candidateId: candidate.id, label: adding, required: true }); setAdding(''); });
        }}>
          <TextField label={t('projectDetail.candidates.addCheck', 'Add a check')} value={adding} onChange={setAdding} maxLength={200} wrapperClassName="flex-1" />
          <Button type="submit" variant="outline" disabled={!adding.trim() || m.addItem.isPending}>{t('projectDetail.candidates.add', 'Add')}</Button>
        </form>
      )}
    </div>
  );
};

const ItemRow: React.FC<{
  item: CandidateItem;
  candidate: WorkOrderCandidate;
  editable: boolean;
  today: string;
  statusLabel: Record<AssessmentStatus, string>;
  owners: { value: string; label: string }[];
  onPatch: (patch: { status?: AssessmentStatus; note?: string | null; ownerId?: string | null; targetDate?: string | null }) => Promise<void>;
  onUpload: (file: File) => Promise<void>;
  onRemoveProof: (proofId: string) => Promise<void>;
}> = ({ item, editable, today, statusLabel, owners, onPatch, onUpload, onRemoveProof }) => {
  const { t } = useTranslation('project');
  const refusal = useRefusalText();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState(item.note ?? '');
  const [needNote, setNeedNote] = useState(false);
  const overdue = item.status !== 'passed' && item.status !== 'not_applicable' && item.target_date !== null && item.target_date < today;
  const variant = item.status === 'passed' ? 'won' : item.status === 'failed' ? 'lost' : 'neutral';

  const openProof = async (path: string) => {
    try { window.open(await repositories.workOrderCandidate.proofUrl(path), '_blank', 'noopener'); }
    catch (err) { toast(refusalLine(refusal(err)), undefined, 'warning'); }
  };

  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">
          {item.label}
          {!item.required && <span className="ml-2 text-control font-normal text-muted-foreground">{t('projectDetail.candidates.optional', 'Optional')}</span>}
        </span>
        {!editable && <StatusPill variant={variant}>{statusLabel[item.status]}</StatusPill>}
        {overdue && <StatusPill variant="overdue">{t('projectDetail.candidates.overdue', 'Overdue')}</StatusPill>}
      </div>
      {editable ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <SelectField compact label={t('projectDetail.candidates.statusLabel', 'Result')} value={item.status}
            options={STATUSES.map((s) => ({ value: s, label: statusLabel[s] }))}
            onChange={(v) => {
              const next = v as AssessmentStatus;
              if (next === 'not_applicable' && !note.trim()) { setNeedNote(true); return; }
              setNeedNote(false);
              void onPatch({ status: next, ...(next === 'not_applicable' ? { note } : {}) });
            }} />
          <SelectField compact label={t('projectDetail.candidates.owner', 'Owner')} value={item.owner_id ?? ''} placeholder={t('projectDetail.candidates.noOwner', 'No owner')}
            options={owners} onChange={(v) => void onPatch({ ownerId: v || null })} />
          <DateField label={t('projectDetail.candidates.target', 'Target date')} value={item.target_date ?? ''} onChange={(v) => void onPatch({ targetDate: v || null })} />
          <TextField label={t('projectDetail.candidates.note', 'Note')} value={note} maxLength={1000}
            error={needNote ? t('projectDetail.candidates.needNote', 'Add a note to mark this not applicable.') : undefined}
            onChange={(v) => { setNote(v); if (v.trim()) setNeedNote(false); }}
            onBlur={() => { if (note !== (item.note ?? '')) void onPatch({ note: note.trim() || null }); }} />
        </div>
      ) : (
        <dl className="grid gap-x-6 gap-y-1 text-control text-muted-foreground sm:grid-cols-3">
          <div><dt className="sr-only">{t('projectDetail.candidates.owner', 'Owner')}</dt><dd>{item.owner_name ?? t('projectDetail.candidates.noOwner', 'No owner')}</dd></div>
          <div><dt className="sr-only">{t('projectDetail.candidates.target', 'Target date')}</dt><dd>{item.target_date ?? ''}</dd></div>
          <div><dt className="sr-only">{t('projectDetail.candidates.note', 'Note')}</dt><dd>{item.note ?? ''}</dd></div>
        </dl>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {item.proofs.map((p) => (
          <span key={p.id} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-control">
            <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => void openProof(p.file_path)}>{p.file_name ?? t('projectDetail.candidates.proof', 'Proof')}</button>
            {editable && <button type="button" className="text-muted-foreground hover:text-foreground" aria-label={t('projectDetail.candidates.removeProof', 'Remove {{name}}', { name: p.file_name ?? p.id })} onClick={() => void onRemoveProof(p.id)}>×</button>}
          </span>
        ))}
        {item.proofs.length === 0 && !editable && <span className="text-control text-muted-foreground">{t('projectDetail.candidates.noProof', 'No proof attached')}</span>}
        {editable && (
          <>
            <FileInput ref={fileRef} accept={ACCEPT} className="sr-only" tabIndex={-1} aria-hidden="true"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onUpload(f); }} />
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>{t('projectDetail.candidates.attach', 'Attach proof')}</Button>
          </>
        )}
      </div>
    </li>
  );
};
