import React, { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  Button, DateField, EntityFormModal, ListState, MobileDecisionBar, ReasonDialog, RecordHeader, RecordSection, RecordStack, StatusPill, TextArea,
  TextField, useToast, type MobileDecisionAction,
} from '@/src/components/ui';
import { BackBar } from '@/src/components/shell';
import { useIsNarrow } from '@/src/components/ui/useIsNarrow';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { can } from '@/src/auth/policy';
import { useProject } from '@/src/hooks/useProjects';
import {
  useQuantityChangeApproval, useQuantityChangeMutations, useQuantityChangeRequest, useQuantityVersions,
} from '@/src/hooks/useQuantityChanges';
import { repositories } from '@/src/lib/repositories';
import { classifyMutationError, joinSentences } from '@/src/lib/classifyMutationError';
import { formatCurrency, formatDay } from '@/src/lib/format';
import { orgDayNow } from '@/src/hooks/useOrgToday';
import { lineValueCents, validateRequestedQuantity, versionValueChanges } from '@/src/lib/quantityChangeRules';
import { formatExactCents, sumDecimal } from '@/src/lib/exactDecimal';
import { waitingForText, waitingRoleLabel } from '@/src/lib/approvals/waitingFor';
import { useRequestedQuantityErrorText } from './requestedQuantityError';
import type { QcrDetail, QcrFileKind, QcrLine } from '@/src/lib/db/quantityChanges';

type Dialog = 'return' | 'withdraw' | 'sent' | 'accepted' | 'declined' | null;

/**
 * `/quantity-changes/:requestId` (#2578). Phone first: the lines, then who must act, with the decision bar in view. Shows only
 * what the server would allow (`can()` mirrors qcr_*; the functions decide). Money is exact (bigint cents), quantities keep 3 decimals.
 */
const QuantityChangeDetail: React.FC = () => {
  const { requestId } = useParams<{ requestId: string }>();
  const query = useQuantityChangeRequest(requestId);
  const { t } = useTranslation('quantityChanges');
  const navigate = useNavigate();
  const back = <div className="hidden max-[920px]:block"><BackBar label={t('title', 'Quantity change requests')} onBack={() => navigate('/quantity-changes')} /></div>;
  if (query.isPending) return (<>{back}<ListState variant="loading" rows={6} /></>);
  if (query.isError) return (<>{back}<ListState variant="error" title={t('detail.error', "Couldn't load this request")} onRetry={() => void query.refetch()} /></>);
  if (!query.data) return (<>{back}<ListState variant="empty" icon="reports" title={t('detail.notFound', 'Request not found')} /></>);
  return (<>{back}<RequestRecord detail={query.data} /></>);
};

const RequestRecord: React.FC<{ detail: QcrDetail }> = ({ detail }) => {
  const { t } = useTranslation(['quantityChanges', 'status', 'waitingList']);
  const { toast } = useToast();
  const narrow = useIsNarrow();
  const userId = useAuth().currentUser?.id ?? null;
  const { realRole } = useEffectiveRole();
  const { request, workOrder, lines, events, files, names } = detail;
  const project = useProject(request.project_id).data ?? null;
  const m = useQuantityChangeMutations();
  const errorWords = useRequestedQuantityErrorText();
  const approval = useQuantityChangeApproval(request.id, request.status === 'pending_approval');
  const ctx = {
    realRole, currentUserId: userId,
    record: { reviewer_listed: approval.data?.can_approve === true, author_id: request.author_id, editor_ids: request.editor_ids, submitted_by: request.submitted_by, project_manager_id: project?.project_manager_id ?? null },
  };
  const status = request.status;
  const mayEdit = (status === 'draft' || status === 'returned') && can('create', 'quantityChange', ctx);
  const maySubmit = status === 'draft' && can('act', 'quantityChange', ctx);
  const mayWithdraw = (status === 'draft' || status === 'returned' || status === 'approved') && can('withdraw', 'quantityChange', ctx);
  const mayDecide = can('decide', 'quantityChange', ctx);
  const mayApproveRole = status === 'pending_approval' && can('approve', 'quantityChange', ctx);

  // fix-waiting item 3: who the pending request waits for (1177: Admin, Executive or Finance; author/editor/
  // submitter excluded). One owned line: the approval section speaks it, gated by the server's own
  // `eligible_approver_exists` fact (1178) so it can never contradict the nobody sentence.
  const waitingLine = status === 'pending_approval'
    ? waitingForText({ names: [], role: waitingRoleLabel('roleFinanceExecAdmin', t) }, t)
    : null;

  const [dialog, setDialog] = useState<Dialog>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<Record<string, { quantity: string; reason: string }>>({});

  const currency = workOrder?.currency ?? 'XXX';
  const money = (v: string) => formatCurrency(Number(v), currency, { precision: 'minor' });
  const valueChange = (l: QcrLine, requested: string | number = l.requested_quantity) => {
    const after = lineValueCents(String(requested), l.rate);
    const before = lineValueCents(String(l.base_quantity), l.rate);
    return after !== null && before !== null ? formatExactCents(after - before) : null;
  };
  const totalChange = sumDecimal(lines.map((l) => valueChange(l)), 2);

  const run = async (work: () => Promise<unknown>, success: string) => {
    try { await work(); toast(success, workOrder?.label ?? '', 'success'); return true; } catch (err) {
      const { headline, detail: d } = classifyMutationError(err);
      toast(headline, d, 'warning');
      setDialogError(d ? joinSentences(headline, d) : headline);
      return false;
    }
  };
  const startEdit = async () => {
    if (status === 'returned') {
      const ok = await run(() => m.updateDraft.mutateAsync({ id: request.id, lines: null }), t('toast.saved', 'Saved'));
      if (!ok) return;
    }
    setEdits(Object.fromEntries(lines.map((l) => [l.id, { quantity: String(l.requested_quantity), reason: l.reason }])));
    setEditing(true);
  };
  const editErrors = lines.map((l) => {
    const d = edits[l.id];
    return d ? validateRequestedQuantity(d.quantity, l.base_quantity, l.trigger_figure) : null;
  });
  const saveEdit = async () => {
    if (editErrors.some(Boolean) || lines.some((l) => !(edits[l.id]?.reason ?? '').trim())) return;
    const ok = await run(() => m.updateDraft.mutateAsync({
      id: request.id,
      lines: lines.map((l) => ({ boqItemId: l.boq_item_id, requestedQuantity: edits[l.id].quantity.trim(), reason: edits[l.id].reason.trim() })),
    }), t('toast.saved', 'Saved'));
    if (ok) setEditing(false);
  };

  const approveRequest = () => run(() => m.approve.mutateAsync(request.id), t('toast.approved', 'Approved'));
  // undefined while the server fact is loading or failed: never assume "eligible" (the old `?? true`).
  const eligible = approval.data?.eligible_approver_exists;
  const blockReason = approval.data && !approval.data.can_approve ? approval.data.reason : null;
  const blockText = {
    role: t('approval.block.role', 'Your role cannot approve quantity change requests.'),
    author: t('approval.block.author', 'You raised this request, so someone else must approve it.'),
    editor: t('approval.block.editor', 'You edited this request, so someone else must approve it.'),
    submitter: t('approval.block.submitter', 'You submitted this request, so someone else must approve it.'),
    status: t('approval.block.status', 'This request is not waiting for approval.'),
  };
  const needsSentFile = status === 'approved' && !files.some((f) => f.kind === 'sent_letter');
  const needsResponseFile = status === 'sent_to_client' && !files.some((f) => f.kind === 'client_response');

  const decisionActions: MobileDecisionAction[] = [
    ...(mayEdit && !editing ? [{ key: 'edit', label: t('actions.edit', 'Edit'), variant: 'outline' as const, onSelect: () => void startEdit() }] : []),
    ...(editing ? [{ key: 'save', label: t('lines.saveEdit', 'Save changes'), onSelect: () => void saveEdit(), loading: m.updateDraft.isPending }] : []),
    ...(maySubmit && !editing ? [{ key: 'submit', label: t('actions.submit', 'Submit for approval'), onSelect: () => void run(() => m.submit.mutateAsync(request.id), t('toast.submitted', 'Submitted for approval')), loading: m.submit.isPending }] : []),
    ...(mayApproveRole && approval.data?.can_approve ? [
      { key: 'return', label: t('actions.return', 'Return'), variant: 'outline' as const, onSelect: () => { setDialogError(null); setDialog('return'); } },
      { key: 'approve', label: t('actions.approve', 'Approve'), onSelect: () => void approveRequest(), loading: m.approve.isPending },
    ] : []),
    ...(status === 'approved' && mayDecide ? [{ key: 'sent', label: t('actions.recordSent', 'Record sent to client'), onSelect: () => { setDialogError(null); setDialog('sent'); }, disabled: needsSentFile }] : []),
    ...(status === 'sent_to_client' && mayDecide ? [
      { key: 'declined', label: t('actions.declined', 'Client declined'), variant: 'outline' as const, onSelect: () => { setDialogError(null); setDialog('declined'); } },
      { key: 'accepted', label: t('actions.accepted', 'Client accepted'), onSelect: () => { setDialogError(null); setDialog('accepted'); }, disabled: needsResponseFile },
    ] : []),
    ...(mayWithdraw && !editing ? [{ key: 'withdraw', label: t('actions.withdraw', 'Withdraw'), variant: 'outline' as const, onSelect: () => { setDialogError(null); setDialog('withdraw'); } }] : []),
  ];

  return (
    <div className="max-sm:pb-[var(--mobile-action-bar-height,0px)]">
      <RecordHeader
        panelInset actionsOnTitleRow clampNameOnMobile
        name={workOrder?.label ?? t('detail.title', 'Quantity change request')}
        status={<span data-testid="qcr-status" data-status={status}><StatusPill record="quantityChange" state={status} /></span>}
        meta={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{formatDay(request.created_at)}</span>
            {project && <Link to={`/projects/${project.id}`} className="text-primary-text hover:underline">{project.name}</Link>}
            {workOrder && <Link to={`/work-orders/${workOrder.id}`} className="text-primary-text hover:underline">{t('detail.workOrder', 'Work order')}</Link>}
            {names.author && <span>{t('detail.authoredBy', { defaultValue: 'Raised by {{name}}', name: names.author })}</span>}
          </span>
        }
        stats={[{ label: t('lines.value', 'Value change'), value: <span data-testid="qcr-total-change">{money(totalChange)}</span> }]}
        actions={narrow ? undefined : (
          <div className="flex flex-wrap gap-2">
            {decisionActions.map((a) => <Button key={a.key} variant={a.variant ?? 'primary'} onClick={a.onSelect} loading={a.loading} disabled={a.disabled}>{a.label}</Button>)}
          </div>
        )}
      >
        {request.note && <p className="text-foreground">{request.note}</p>}
      </RecordHeader>

      <RecordStack>
        {status === 'returned' && (
          <div role="status" className="rounded-lg border border-warning/30 bg-waiting-surface px-3.5 py-3" data-testid="qcr-returned">
            <div className="font-semibold text-warning-foreground">{t('detail.returned', 'Returned')}{request.returned_at ? ` · ${formatDay(request.returned_at)}` : ''}</div>
            <div className="text-foreground">{request.return_reason}</div>
          </div>
        )}
        {status === 'withdrawn' && (
          <div role="status" className="rounded-lg border border-border bg-surface px-3.5 py-3" data-testid="qcr-withdrawn">
            <div className="font-semibold text-foreground">{t('detail.withdrawn', 'Withdrawn')}{request.withdrawn_from ? ` · ${t('detail.withdrawnFrom', { defaultValue: 'Withdrawn from {{status}}', status: t(`status:quantityChange.${request.withdrawn_from}`) })}` : ''}</div>
            <div className="text-foreground">{request.withdraw_reason}</div>
          </div>
        )}
        {status === 'client_declined' && <p className="text-foreground" data-testid="qcr-declined">{t('detail.declinedNote', 'The client declined. No quantity changed.')}</p>}
        {status === 'client_accepted' && <p className="text-foreground" data-testid="qcr-accepted">{t('detail.acceptedNote', 'The client accepted. The contract quantities and allocations below now hold the new figures.')}</p>}

        {workOrder && status !== 'client_declined' && status !== 'withdrawn' && (
          <p className="rounded-lg border border-border bg-surface px-3.5 py-3 text-foreground" data-testid="qcr-billing-note">
            {workOrder.status === 'Draft'
              ? t('billing.draftNote', 'This work order is still a draft: accepting this request raises its value by the value change.')
              : t('billing.issuedNote', 'This work order is issued: its value is fixed, so the extra quantity can be billed only after the work order is cancelled and re-issued with the new value.')}
          </p>
        )}

        <RecordSection title={t('lines.title', 'Lines')} data-testid="qcr-lines">
          <ul className="space-y-4">
            {lines.map((l, i) => {
              const draft = edits[l.id];
              return (
                <li key={l.id} className="space-y-2" data-testid="qcr-line">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium text-foreground">{l.item_code} · {l.description}</span>
                    <span className="tabular-nums text-foreground" data-testid="qcr-line-change">{money(valueChange(l, editing && draft ? draft.quantity || l.requested_quantity : l.requested_quantity) ?? '0.00')}</span>
                  </div>
                  <p className="text-muted-foreground">
                    {t('lines.trigger', 'Trigger')}: {t(`over.kind.${l.trigger_kind}`)} {l.trigger_figure} · {t('lines.contract', 'Contract quantity')} {l.base_quantity} {l.unit}
                  </p>
                  {editing && draft ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <TextField label={t('raise.requested', { defaultValue: 'Requested total quantity ({{unit}})', unit: l.unit })} inputMode="decimal" value={draft.quantity}
                        error={editErrors[i] ? errorWords(editErrors[i]!, { contract: l.base_quantity, figure: l.trigger_figure }) : undefined}
                        onChange={(v) => setEdits((p) => ({ ...p, [l.id]: { ...p[l.id], quantity: v } }))} />
                      <TextArea label={t('lines.reason', 'Reason')} value={draft.reason} maxLength={500} onChange={(v) => setEdits((p) => ({ ...p, [l.id]: { ...p[l.id], reason: v } }))} />
                    </div>
                  ) : (
                    <>
                      <p className="tabular-nums text-foreground">{t('lines.requested', 'Requested')} {l.requested_quantity} {l.unit}</p>
                      <p className="text-foreground">{l.reason}</p>
                    </>
                  )}
                  <VersionHistory line={l} currency={currency} />
                </li>
              );
            })}
          </ul>
          {editing && <Button variant="ghost" className="mt-3" onClick={() => setEditing(false)}>{t('lines.cancelEdit', 'Cancel')}</Button>}
        </RecordSection>

        {status === 'pending_approval' && (
          <RecordSection title={t('approval.title', 'Internal approval')} data-testid="qcr-approval">
            {eligible === false ? (
              <p className="text-foreground" data-testid="qcr-approval-nobody">{t('approval.nobody', 'Nobody else can approve this request: it waits until another approver exists.')}</p>
            ) : eligible === true && waitingLine ? (
              <p className="text-foreground" data-testid="qcr-waiting-approval">{waitingLine}</p>
            ) : (
              <p className="text-foreground" data-testid="qcr-approval-checking">
                {approval.isError
                  ? t('common:uxs32.routeUnavailable', "Couldn't verify who can approve right now.")
                  : t('approval.waiting', 'Waiting for approval')}
              </p>
            )}
            {approval.isError && (
              <Button variant="outline" size="sm" onClick={() => void approval.refetch()}>{t('common:ui.listState.retry', 'Retry')}</Button>
            )}
            {blockReason && <p className="text-foreground" data-testid="qcr-approval-block">{blockText[blockReason]}</p>}
          </RecordSection>
        )}
        {request.approved_at && names.approver && (
          <p className="text-foreground" data-testid="qcr-approved-by">{t('approval.approvedBy', { defaultValue: 'Approved by {{name}}', name: names.approver })} · {formatDay(request.approved_at)}</p>
        )}

        <RecordSection title={t('client.title', 'Client')} data-testid="qcr-client">
          {request.sent_date ? (
            <>
              <p className="text-foreground">{t('client.sentOn', { defaultValue: 'Sent on {{date}}', date: formatDay(request.sent_date) })}</p>
              <p className="text-foreground">{t('client.reference', { defaultValue: 'Client reference {{ref}}', ref: request.client_reference })}</p>
            </>
          ) : <p className="text-muted-foreground">{t('client.notSent', 'Not sent yet')}</p>}
          {request.decision_date && <p className="text-foreground">{t('client.decidedOn', { defaultValue: 'Decision on {{date}}', date: formatDay(request.decision_date) })}</p>}
        </RecordSection>

        <FilesSection detail={detail} />

        <RecordSection title={t('history.title', 'History')}>
          <ol className="space-y-1">
            {events.map((e) => (
              <li key={e.id} className="text-foreground">
                <span className="tabular-nums text-muted-foreground">{formatDay(e.created_at)}</span> {t(`history.${e.action}`, e.action)}{e.reason ? ` · ${e.reason}` : ''}
              </li>
            ))}
          </ol>
        </RecordSection>
      </RecordStack>

      {narrow && decisionActions.length > 0 && <MobileDecisionBar actions={decisionActions} label={t('actions.label', 'Request actions')} />}

      <ReasonDialog open={dialog === 'return'} kind="return" subject={t('dialog.returnSubject', 'request')} maxLength={500}
        loading={m.returnRequest.isPending} error={dialogError} onCancel={() => setDialog(null)}
        onConfirm={(reason) => void run(() => m.returnRequest.mutateAsync({ id: request.id, reason }), t('toast.returned', 'Returned')).then((ok) => ok && setDialog(null))} />
      <ReasonDialog open={dialog === 'withdraw'} kind="reject" title={t('dialog.withdrawTitle', 'Withdraw this request')} label={t('dialog.withdrawLabel', 'Reason for withdrawing')}
        confirmLabel={t('actions.withdraw', 'Withdraw')} maxLength={500} loading={m.withdraw.isPending} error={dialogError} onCancel={() => setDialog(null)}
        onConfirm={(reason) => void run(() => m.withdraw.mutateAsync({ id: request.id, reason }), t('toast.withdrawn', 'Withdrawn')).then((ok) => ok && setDialog(null))} />
      {dialog === 'sent' && <SentDialog onClose={() => setDialog(null)} error={dialogError} loading={m.recordSent.isPending}
        onConfirm={(sentDate, ref) => void run(() => m.recordSent.mutateAsync({ id: request.id, sentDate, clientReference: ref }), t('toast.sent', 'Recorded as sent')).then((ok) => ok && setDialog(null))} />}
      {(dialog === 'accepted' || dialog === 'declined') && <DecisionDialog accepted={dialog === 'accepted'} onClose={() => setDialog(null)} error={dialogError}
        loading={m.recordDecision.isPending} min={request.sent_date ?? undefined}
        onConfirm={(date, note) => void run(() => m.recordDecision.mutateAsync({ id: request.id, decision: dialog === 'accepted' ? 'accepted' : 'declined', decisionDate: date, note }),
          dialog === 'accepted' ? t('toast.accepted', 'Client acceptance recorded') : t('toast.declined', 'Client decline recorded')).then((ok) => ok && setDialog(null))} />}
    </div>
  );
};

/** FR-QCR-020: the item's versions with the value change at its rate, from stored rows; opened on demand. */
const VersionHistory: React.FC<{ line: QcrLine; currency: string }> = ({ line, currency }) => {
  const { t } = useTranslation('quantityChanges');
  const [open, setOpen] = useState(false);
  const versions = useQuantityVersions(line.boq_item_id, open);
  const rows = useMemo(() => versionValueChanges(versions.data ?? [], line.rate), [versions.data, line.rate]);
  const money = (v: string | null) => (v === null ? '—' : formatCurrency(Number(v), currency, { precision: 'minor' }));
  return (
    <div>
      <Button variant="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{t('lines.history', 'Version history')}</Button>
      {open && (versions.isError ? <ListState variant="error" title={t("common:ui.errorBoundary.title", "Something went wrong")} onRetry={() => void versions.refetch()} /> : versions.isPending ? <ListState variant="loading" rows={2} /> : rows.length === 0 ? <p className="text-muted-foreground">{t('lines.noHistory', 'No versions')}</p> : (
        <ol className="mt-1 space-y-1" data-testid="qcr-versions">
          {rows.map((v) => (
            <li key={v.version_no} className="flex flex-wrap gap-x-3 text-foreground">
              <span>{t('lines.version', { defaultValue: 'Version {{n}}', n: v.version_no })}</span>
              <span className="tabular-nums">{v.quantity} {line.unit}</span>
              <span className="text-muted-foreground">{t(`lines.source.${v.source}`)}</span>
              <span className="tabular-nums">{money(v.value)}</span>
              {v.change !== null && <span className="tabular-nums" data-testid="qcr-version-change">{money(v.change)}</span>}
              {v.reason && <span className="text-muted-foreground" data-testid="qcr-version-reason">{v.reason}</span>}
            </li>
          ))}
        </ol>
      ))}
    </div>
  );
};

const FILE_KINDS_BY_STATUS: Partial<Record<string, QcrFileKind>> = { draft: 'supporting', returned: 'supporting', pending_approval: 'supporting', approved: 'sent_letter', sent_to_client: 'client_response' };

const FilesSection: React.FC<{ detail: QcrDetail }> = ({ detail }) => {
  const { t } = useTranslation('quantityChanges');
  const { toast } = useToast();
  const m = useQuantityChangeMutations();
  const { realRole } = useEffectiveRole();
  const input = useRef<HTMLInputElement>(null);
  const { request, files } = detail;
  const addKind = FILE_KINDS_BY_STATUS[request.status];
  const mayAdd = addKind !== undefined && can('create', 'quantityChange', { realRole });
  const open = async (path: string) => {
    try { window.open(await repositories.quantityChange.fileUrl(path), '_blank', 'noopener'); } catch (err) {
      const { headline, detail: d } = classifyMutationError(err);
      toast(headline, d, 'warning');
    }
  };
  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !addKind) return;
    try { await m.uploadFile.mutateAsync({ request, kind: addKind, file }); toast(t('files.uploaded', 'File attached'), file.name, 'success'); } catch (err) {
      const { headline, detail: d } = classifyMutationError(err);
      toast(headline, d, 'warning');
    }
  };
  return (
    <RecordSection title={t('files.title', 'Files')} data-testid="qcr-files"
      actions={mayAdd ? (
        <>
          <input ref={input} type="file" accept="application/pdf,image/*" className="sr-only" data-testid="qcr-file-input" aria-label={t(`files.kind.${addKind}`)} onChange={(e) => void onPick(e)} />
          <Button variant="outline" onClick={() => input.current?.click()} loading={m.uploadFile.isPending}>{t('files.add', 'Attach file')} · {t(`files.kind.${addKind}`)}</Button>
        </>
      ) : undefined}>
      {request.status === 'approved' && !files.some((f) => f.kind === 'sent_letter') && <p className="text-foreground">{t('files.needSent', 'Attach the letter or form sent to the client before recording the send')}</p>}
      {request.status === 'sent_to_client' && !files.some((f) => f.kind === 'client_response') && <p className="text-foreground">{t('files.needResponse', "Attach the client's acceptance before recording it")}</p>}
      {files.length === 0 ? <p className="text-muted-foreground">{t('files.none', 'No files')}</p> : (
        <ul className="divide-y divide-border">
          {files.map((f) => (
            <li key={f.id} className="flex min-h-11 flex-wrap items-center justify-between gap-3 py-2" data-testid="qcr-file">
              <span className="text-foreground">{f.title ?? f.file_path.split('/').pop()} · <span className="text-muted-foreground">{t(`files.kind.${f.kind}`)}</span></span>
              <span className="flex gap-2">
                <Button variant="ghost" onClick={() => void open(f.file_path)}>{t('files.open', 'Open')}</Button>
                {request.status !== 'client_accepted' && request.status !== 'client_declined' && request.status !== 'withdrawn' && addKind === f.kind && (
                  <Button variant="ghost" onClick={() => void m.archiveFile.mutateAsync(f.id)}>{t('files.remove', 'Remove')}</Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </RecordSection>
  );
};

const SentDialog: React.FC<{ onClose: () => void; onConfirm: (date: string, ref: string) => void; error: string | null; loading: boolean }> = ({ onClose, onConfirm, error, loading }) => {
  const { t } = useTranslation('quantityChanges');
  const [date, setDate] = useState(orgDayNow());
  const [ref, setRef] = useState('');
  return (
    <EntityFormModal open title={t('dialog.sentTitle', 'Record sent to the client')} submitLabel={t('actions.confirm', 'Confirm')} onSubmit={(e) => { e.preventDefault(); onConfirm(date, ref.trim()); }}
      onClose={onClose} submitDisabled={!date || ref.trim() === ''} loading={loading} submitError={error ? { headline: error } : null}>
      <DateField label={t('client.sentDate', 'Date sent')} required value={date} onChange={setDate} max={orgDayNow()} />
      <TextField label={t('client.referenceLabel', 'Client reference')} required value={ref} onChange={setRef} />
    </EntityFormModal>
  );
};

const DecisionDialog: React.FC<{ accepted: boolean; min?: string; onClose: () => void; onConfirm: (date: string, note: string | null) => void; error: string | null; loading: boolean }> = ({ accepted, min, onClose, onConfirm, error, loading }) => {
  const { t } = useTranslation('quantityChanges');
  const [date, setDate] = useState(orgDayNow());
  const [note, setNote] = useState('');
  return (
    <EntityFormModal open title={accepted ? t('actions.accepted', 'Client accepted') : t('actions.declined', 'Client declined')} submitLabel={t('actions.confirm', 'Confirm')}
      onSubmit={(e) => { e.preventDefault(); onConfirm(date, note.trim() || null); }} onClose={onClose} submitDisabled={!date} loading={loading} submitError={error ? { headline: error } : null}>
      <DateField label={t('client.decisionDate', 'Decision date')} required value={date} onChange={setDate} min={min} max={orgDayNow()} />
      <TextArea label={t('client.decisionNote', 'Note')} value={note} maxLength={500} onChange={setNote} />
    </EntityFormModal>
  );
};

export default QuantityChangeDetail;
