import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Button, DateField, EntityFormModal, FormGrid, ListState, ReasonDialog, StatusPill, TextArea, TextField, useToast, type SubmitError } from '@/src/components/ui';
import { RecordSection } from '@/src/components/ui/RecordSection';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { useOrgToday } from '@/src/hooks/useOrgToday';
import { useCandidateMutations, useCandidateTemplate, useProjectCandidates } from '@/src/hooks/useWorkOrderCandidates';
import { deriveAssessment } from '@/src/lib/candidateAssessment';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatDate } from '@/src/lib/format';
import type { WorkOrderCandidate } from '@/src/lib/db/workOrderCandidates';
import { CandidateChecklist } from './CandidateChecklist';
import { refusalLine, useRefusalText } from '@/src/lib/refusals';

/**
 * #2595 (FR-CWO-001, 009..016): the candidate work orders of one contract, each with the organisation's assessment checklist
 * and an accept or reject decision with its reason. Shown only when the organisation has set an assessment checklist or the
 * project already has a candidate (AC-CWO-018), so an organisation that does not use it sees nothing new. `can()` draws the
 * controls; RLS and the decision RPC decide (ADR-0016).
 */
export const CandidateWorkOrders: React.FC<{ projectId: string; projectManagerId: string | null }> = ({ projectId, projectManagerId }) => {
  const { t } = useTranslation('project');
  const may = usePermission();
  const { currentUser } = useAuth();
  const today = useOrgToday();
  const template = useCandidateTemplate();
  const candidates = useProjectCandidates(projectId);
  const [form, setForm] = useState<{ replaces: WorkOrderCandidate | null } | null>(null);

  const used = (template.data?.length ?? 0) > 0 || (candidates.data?.length ?? 0) > 0;
  if (!used) return null;

  const record = { currentUserId: currentUser?.id ?? null, record: { project_manager_id: projectManagerId } };
  const canCreate = may('create', 'workOrderCandidate', record);
  const title = t('projectDetail.candidates.title', 'Candidate work orders');
  return (
    <RecordSection title={title} data-testid="candidate-work-orders"
      actions={canCreate ? <Button variant="outline" size="sm" onClick={() => setForm({ replaces: null })}>{t('projectDetail.candidates.new', 'New candidate')}</Button> : undefined}>
      {candidates.isError ? (
        <ListState variant="error" title={t('projectDetail.candidates.loadError', "Couldn't load the candidates")} onRetry={() => void candidates.refetch()} />
      ) : !candidates.data ? (
        <ListState variant="loading" rows={2} />
      ) : candidates.data.length === 0 ? (
        <p className="text-control text-muted-foreground">{t('projectDetail.candidates.empty', 'No candidates yet. Open one to assess the work before a work order is raised.')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {candidates.data.map((c) => (
            <CandidateCard key={c.id} candidate={c} projectId={projectId} today={today} record={record}
              onReplace={() => setForm({ replaces: c })} />
          ))}
        </ul>
      )}
      {form && <CandidateForm projectId={projectId} replaces={form.replaces} onClose={() => setForm(null)} />}
    </RecordSection>
  );
};

const CandidateCard: React.FC<{
  candidate: WorkOrderCandidate; projectId: string; today: string; record: { currentUserId: string | null; record: { project_manager_id: string | null } }; onReplace: () => void;
}> = ({ candidate: c, projectId, today, record, onReplace }) => {
  const { t } = useTranslation('project');
  const refusal = useRefusalText();
  const may = usePermission();
  const { toast } = useToast();
  const m = useCandidateMutations(projectId);
  const [open, setOpen] = useState(c.status === 'assessing');
  const [deciding, setDeciding] = useState<'accepted' | 'rejected' | null>(null);
  const [decisionError, setDecisionError] = useState<string>();
  const a = deriveAssessment(c.items, today);
  const canEdit = may('edit', 'workOrderCandidate', record);
  const canDecide = may('approve', 'workOrderCandidate', record);
  const headingId = `candidate-${c.id}`;

  const statusPill = c.status === 'accepted' ? <StatusPill variant="won">{t('projectDetail.candidates.accepted', 'Accepted')}</StatusPill>
    : c.status === 'rejected' ? <StatusPill variant="lost">{t('projectDetail.candidates.rejected', 'Rejected')}</StatusPill>
    : <StatusPill variant="progress">{t('projectDetail.candidates.assessing', 'Assessing')}</StatusPill>;

  const decide = async (reason: string) => {
    if (!deciding) return;
    setDecisionError(undefined);
    try {
      const r = await m.decide.mutateAsync({ candidateId: c.id, decision: deciding, reason });
      toast(r.status === 'accepted' ? t('projectDetail.candidates.acceptedToast', 'Candidate accepted. A draft work order was created.') : t('projectDetail.candidates.rejectedToast', 'Candidate rejected.'), undefined, 'success');
      setDeciding(null);
    } catch (err) { setDecisionError(refusalLine(refusal(err))); }
  };

  return (
    <li className="rounded-lg border border-border p-3 sm:p-4" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={headingId} className="text-base font-semibold">{c.title}</h3>
          <p className="text-control text-muted-foreground">
            {t('projectDetail.candidates.offered', 'Offered {{date}}', { date: formatDate(c.offered_on) })}
            {c.client_reference ? ` · ${c.client_reference}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {statusPill}
          {c.status === 'assessing' && a.requiredCount > 0 && (
            <span className="text-control text-muted-foreground">{t('projectDetail.candidates.ready', '{{ready}} of {{required}} required checks ready', { ready: a.readyRequired, required: a.requiredCount })}</span>
          )}
          {c.status === 'assessing' && a.overdue.length > 0 && <StatusPill variant="overdue">{t('projectDetail.candidates.overdueCount', '{{n}} overdue', { n: a.overdue.length })}</StatusPill>}
          <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? t('projectDetail.candidates.hide', 'Hide checks') : t('projectDetail.candidates.show', 'Show checks')}
          </Button>
        </div>
      </div>
      {c.description && <p className="mt-2 max-w-prose text-control">{c.description}</p>}
      {c.status !== 'assessing' && (
        <div className="mt-3 rounded-md bg-muted p-3 text-control">
          <p><span className="font-medium">{c.status === 'accepted' ? t('projectDetail.candidates.acceptedBecause', 'Accepted because') : t('projectDetail.candidates.rejectedBecause', 'Rejected because')}</span>{' '}{c.decision_reason}</p>
          <div className="mt-2 flex flex-wrap gap-3">
            {c.work_order_id && <Link className="text-primary underline-offset-2 hover:underline" to={`/work-orders/${c.work_order_id}`}>{t('projectDetail.candidates.openDraft', 'Open the draft work order')}</Link>}
            {c.status === 'rejected' && may('create', 'workOrderCandidate', record) && (
              <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={onReplace}>{t('projectDetail.candidates.reopen', 'Open a new candidate for this offer')}</button>
            )}
          </div>
        </div>
      )}
      {open && <div className="mt-3"><CandidateChecklist candidate={c} canEdit={canEdit} today={today} projectId={projectId} /></div>}
      {c.status === 'assessing' && canDecide && (
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
          {!a.readyToAccept && (
            <span className="mr-auto text-control text-muted-foreground">{t('projectDetail.candidates.notReady', 'Not ready to accept: {{names}}', { names: a.blocking.map((i) => i.label).join(', ') })}</span>
          )}
          <Button variant="outline" onClick={() => { setDecisionError(undefined); setDeciding('rejected'); }}>{t('projectDetail.candidates.reject', 'Reject')}</Button>
          <Button variant="primary" disabled={!a.readyToAccept} onClick={() => { setDecisionError(undefined); setDeciding('accepted'); }}>{t('projectDetail.candidates.accept', 'Accept')}</Button>
        </div>
      )}
      <ReasonDialog open={deciding !== null} kind={deciding === 'rejected' ? 'reject' : 'return'} maxLength={500}
        title={deciding === 'rejected' ? t('projectDetail.candidates.rejectTitle', 'Reject this candidate') : t('projectDetail.candidates.acceptTitle', 'Accept this candidate')}
        label={t('projectDetail.candidates.reasonLabel', 'Reason')}
        helper={deciding === 'accepted' ? t('projectDetail.candidates.acceptHelp', 'Accepting creates a draft work order. It is not issued and carries no value yet.') : t('projectDetail.candidates.rejectHelp', 'The reason stays on the record.')}
        confirmLabel={deciding === 'rejected' ? t('projectDetail.candidates.reject', 'Reject') : t('projectDetail.candidates.accept', 'Accept')}
        loading={m.decide.isPending} error={decisionError} onConfirm={(r) => void decide(r)} onCancel={() => setDeciding(null)} />
    </li>
  );
};

const CandidateForm: React.FC<{ projectId: string; replaces: WorkOrderCandidate | null; onClose: () => void }> = ({ projectId, replaces, onClose }) => {
  const { t } = useTranslation('project');
  const { toast } = useToast();
  const m = useCandidateMutations(projectId);
  const [title, setTitle] = useState(replaces?.title ?? '');
  const [description, setDescription] = useState(replaces?.description ?? '');
  const [reference, setReference] = useState(replaces?.client_reference ?? '');
  const [offeredOn, setOffered] = useState('');
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const invalid = !title.trim();
  return (
    <EntityFormModal open title={replaces ? t('projectDetail.candidates.newFor', 'New candidate for this offer') : t('projectDetail.candidates.new', 'New candidate')}
      submitLabel={t('projectDetail.candidates.create', 'Open candidate')} submitDisabled={invalid || m.create.isPending} loading={m.create.isPending}
      dirty={Boolean(title || description || reference || offeredOn)} submitError={submitError} onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault();
        if (invalid) return;
        setSubmitError(null);
        m.create.mutateAsync({ title, description, clientReference: reference, offeredOn: offeredOn || null, replacesId: replaces?.id ?? null })
          .then(() => { toast(t('projectDetail.candidates.created', 'Candidate opened'), title, 'success'); onClose(); })
          .catch((err: unknown) => setSubmitError(classifyMutationError(err, { '42501': t('projectDetail.candidates.errCreate', 'Only an administrator, an engineer or this project\'s manager can open a candidate.') })));
      }}>
      <FormGrid>
        <TextField id="candidate-title" label={t('projectDetail.candidates.titleLabel', 'Title')} value={title} onChange={setTitle} required maxLength={200} autoComplete="off" />
        <TextField id="candidate-reference" label={t('projectDetail.candidates.referenceLabel', 'Client reference')} value={reference} onChange={setReference} maxLength={200} autoComplete="off" />
        <DateField id="candidate-offered" label={t('projectDetail.candidates.offeredLabel', 'Offered on')} value={offeredOn} onChange={setOffered} />
        <TextArea id="candidate-description" label={t('projectDetail.candidates.descriptionLabel', 'Description')} value={description} onChange={setDescription} maxLength={2000} rows={3} fullWidth />
      </FormGrid>
    </EntityFormModal>
  );
};
