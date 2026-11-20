import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, ListState, ReasonDialog, RecordHeader, RecordSection, RecordStack, SelectField, useToast } from '@/src/components/ui';
import { BackBar } from '@/src/components/shell';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { useMaterialRequest, useMaterialRequestMutations, useWaitingForMe } from '@/src/hooks/useMaterialRequests';
import { useStockItems, useStockKeepers, useStockWarehouses } from '@/src/hooks/useStock';
import { formatDay } from '@/src/lib/format';
import { RequestStatusPill, RequestWorkOrder, StepStatusPill } from './materialRequests/shared';
import { useLabels, useRefusalText, useUserNames } from './materialRequests/useMaterialRequestText';

type Dialog = null | { kind: 'return' | 'reject' } | { kind: 'approve' } | { kind: 'withdraw' } | { kind: 'retry' };

/** One request: the chain and who acted, the lines against plan, the decision controls, and the link to the transfer draft. */
const MaterialRequestDetailPage: React.FC = () => {
  const { t } = useTranslation('materialRequests');
  const { requestId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { currentUser } = useAuth();
  const may = usePermission();
  const refusal = useRefusalText();
  const name = useUserNames();
  const labels = useLabels();
  const q = useMaterialRequest(requestId);
  const waiting = useWaitingForMe();
  const { data: items } = useStockItems(true);
  const { data: warehouses } = useStockWarehouses();
  const { data: keepers } = useStockKeepers();
  const m = useMaterialRequestMutations();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [source, setSource] = useState('');
  const [dialogError, setDialogError] = useState<string | null>(null);

  if (q.isPending) return <ListState variant="loading" rows={4} />;
  if (q.isError) return <ListState variant="error" title={t('detail.error', "Couldn't load this request")} onRetry={() => void q.refetch()} />;
  const req = q.data;
  if (!req) return <ListState variant="empty" title={t('detail.notFound', 'Request not found')} />;

  const round = req.steps.filter((s) => s.round === req.round && s.status !== 'superseded');
  const last = round.reduce((n, s) => Math.max(n, s.position), 0);
  const open = round.find((s) => s.status === 'open');
  const mine = (waiting.data ?? []).find((w) => w.requestId === req.id && w.stepPosition === open?.position);
  const ctx = { record: { status: req.status, created_by: req.createdBy, inMyQueue: Boolean(mine) }, currentUserId: currentUser?.id };
  const canDecide = Boolean(open) && may('decide', 'materialRequest', ctx);
  const canEdit = may('edit', 'materialRequest', ctx);
  const canWithdraw = may('withdraw', 'materialRequest', ctx);
  const needsSource = open?.position === last;
  const itemName = (id: string) => { const i = items?.find((x) => x.id === id); return i ? `${i.code} · ${i.name}` : '—'; };
  const sourceWarehouses = (warehouses ?? []).filter((w) => w.kind === 'central' && !w.archived_at);
  const sourceOptions = sourceWarehouses.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }));
  const retrySourceOptions = sourceWarehouses
    .filter((w) => may('create', 'stockDocument', { record: { isKeeper: keepers?.some((k) => k.warehouse_id === w.id && k.user_id === currentUser?.id) ?? false } }))
    .map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }));
  // The retry RPC refuses both the author and anyone who is not a source-warehouse keeper or Admin.
  const canRetryTransfer = req.status === 'approved' && (!req.transferDocumentId || req.transferCancelled) &&
    req.createdBy !== currentUser?.id && retrySourceOptions.length > 0;
  const noApprover = req.status === 'pending' && !open;

  const close = () => { setDialog(null); setDialogError(null); };
  const run = async (work: () => Promise<unknown>, success: string) => {
    setDialogError(null);
    try { await work(); toast(success, req.number, 'success'); close(); }
    catch (err) { setDialogError(refusal(err)); }
  };
  const decide = (decision: 'approve' | 'return' | 'reject', reason?: string) => run(
    () => m.decide.mutateAsync({ id: req.id, position: open!.position, decision, reason, sourceWarehouseId: decision === 'approve' && needsSource ? source : null }),
    decision === 'approve' ? t('detail.approved', 'Step approved') : decision === 'return' ? t('detail.returned', 'Sent back to the requester') : t('detail.rejected', 'Request rejected'));

  return (
    <div>
      <div className="hidden max-[920px]:block"><BackBar label={t('form.back', 'Material requests')} onBack={() => navigate('/material-requests')} /></div>
      <RecordHeader panelInset name={req.number} status={<RequestStatusPill status={req.status} />}
        meta={<span>{t('detail.meta', 'Raised by {{name}} · needed by {{date}}', { name: name(req.createdBy), date: formatDay(req.neededBy) })}</span>}
        primaryAction={canDecide ? <Button variant="primary" onClick={() => setDialog({ kind: 'approve' })}>{t('detail.approve', 'Approve')}</Button>
          : canEdit ? <Button variant="primary" onClick={() => navigate(`/material-requests/${req.id}/edit`)}>{t('detail.edit', 'Edit and send')}</Button> : undefined}
        menuItems={[
          ...(canDecide ? [
            { key: 'return', label: t('detail.return', 'Send back'), onSelect: () => setDialog({ kind: 'return' }) },
            { key: 'reject', label: t('detail.reject', 'Reject'), onSelect: () => setDialog({ kind: 'reject' }) }] : []),
          ...(canWithdraw ? [{ key: 'withdraw', label: t('detail.withdraw', 'Withdraw request'), onSelect: () => setDialog({ kind: 'withdraw' }) }] : []),
        ]} menuLabel={t('detail.moreActions', 'More actions')}>
        <p><span className="text-muted-foreground">{t('list.columns.workOrder', 'Work order')}: </span><RequestWorkOrder workOrderId={req.workOrderId} projectId={req.projectId} /></p>
        {req.note && <p>{req.note}</p>}
      </RecordHeader>

      <RecordStack>
        {req.transferDocumentId && (
          <RecordSection title={t('detail.transfer', 'Delivery')}>
            <p>
              {req.status === 'fulfilled' ? t('detail.transferPosted', 'The stock keeper has posted the transfer.') : t('detail.transferDraft', 'A transfer draft is ready for the stock keeper to post.')}{' '}
              <Link to={`/stock/documents/${req.transferDocumentId}`} className="font-medium text-primary-text hover:underline">{t('detail.openTransfer', 'Open the delivery document')}</Link>
            </p>
            {req.transferCancelled && <p role="status" className="text-warning-foreground">{t('detail.transferCancelled', 'The transfer was cancelled. The request is still approved.')}</p>}
          </RecordSection>
        )}
        {canRetryTransfer && (
          <RecordSection title={t('detail.transfer', 'Delivery')}>
            {!req.transferDocumentId && <p role="alert">{t('detail.noTransfer', 'Approved, but the transfer draft could not be created.')}</p>}
            <Button variant="outline" onClick={() => setDialog({ kind: 'retry' })}>{t('detail.retry', 'Create the transfer again')}</Button>
          </RecordSection>
        )}

        <RecordSection title={t('detail.chain', 'Approval')}>
          {noApprover && <p role="status" className="mb-2 text-warning-foreground">{t('detail.noApprover', 'No approver is available for the open step. Ask an administrator.')}</p>}
          {round.length === 0 ? <p className="text-muted-foreground">{t('detail.notSent', 'Not sent for approval yet.')}</p> : (
            <ol className="space-y-2" data-testid="mrq-chain">
              {round.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium">{t('list.stepOf', 'Step {{n}}: {{label}}', { n: s.position, label: s.label })}</span>
                  <StepStatusPill status={s.status} />
                  {s.decidedBy && <span className="text-control text-muted-foreground">
                    {s.actedFor
                      ? t('detail.actedFor', '{{who}} for {{for}}, {{date}}', { who: name(s.decidedBy), for: name(s.actedFor), date: formatDay(s.decidedAt ?? '') })
                      : t('detail.actedBy', '{{who}}, {{date}}', { who: name(s.decidedBy), date: formatDay(s.decidedAt ?? '') })}</span>}
                  {s.reason && <span className="w-full text-control">{s.reason}</span>}
                </li>
              ))}
            </ol>
          )}
        </RecordSection>

        <RecordSection title={t('detail.lines', 'Items')}>
          <ul className="divide-y divide-border">
            {req.lines.map((l) => (
              <li key={l.id} className="py-2" data-testid="mrq-detail-line">
                <div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{itemName(l.itemId)}</span><span className="tabular-nums">{l.quantity}</span></div>
                {l.planQty !== null && <div className="text-control text-muted-foreground">{t('form.planLine', 'Plan {{plan}} · already requested {{prior}} · new total {{total}}', { plan: l.planQty, prior: l.priorQty ?? 0, total: (l.priorQty ?? 0) + l.quantity })}</div>}
                {l.overPlanReason && <div className="text-control">{t('detail.overPlanReason', 'Over plan: {{reason}}', { reason: l.overPlanReason })}</div>}
              </li>
            ))}
          </ul>
        </RecordSection>

        <RecordSection title={t('detail.history', 'History')}>
          <ul className="space-y-1 text-control">
            {req.events.map((e) => (
              <li key={e.id}>{formatDay(e.createdAt)} · {labels.event[e.action] ?? e.action} · {name(e.actorId)}{e.actedFor ? ` (${t('detail.standingFor', 'for {{name}}', { name: name(e.actedFor) })})` : ''}{e.reason ? ` — ${e.reason}` : ''}</li>
            ))}
          </ul>
        </RecordSection>
      </RecordStack>

      <ConfirmDialog open={dialog?.kind === 'approve'} title={t('detail.approveTitle', 'Approve this step')} confirmLabel={t('detail.approve', 'Approve')}
        description={needsSource
          ? <SelectField label={t('detail.source', 'Warehouse the material leaves from')} required value={source} onChange={setSource} fullWidth
              options={[{ value: '', label: t('detail.chooseSource', 'Choose a warehouse') }, ...sourceOptions]} helper={t('detail.sourceHelp', 'You must keep this warehouse. The transfer is created as a draft.')} />
          : t('detail.approveBody', 'Approve step {{n}} of {{number}}.', { n: open?.position, number: req.number })}
        confirmDisabled={needsSource && !source} loading={m.decide.isPending} error={dialogError} onCancel={close} onConfirm={() => void decide('approve')} />
      <ReasonDialog open={dialog?.kind === 'return' || dialog?.kind === 'reject'} kind={dialog?.kind === 'reject' ? 'reject' : 'return'}
        subject={t('detail.subject', 'material request')} loading={m.decide.isPending} error={dialogError} onCancel={close}
        onConfirm={(reason) => void decide(dialog?.kind === 'reject' ? 'reject' : 'return', reason)} />
      <ConfirmDialog open={dialog?.kind === 'withdraw'} tone="destructive" title={t('detail.withdrawTitle', 'Withdraw this request')} confirmLabel={t('detail.withdraw', 'Withdraw request')}
        description={t('detail.withdrawBody', 'The request is cancelled and its approvers are no longer asked.')} loading={m.cancel.isPending} error={dialogError}
        onCancel={close} onConfirm={() => void run(() => m.cancel.mutateAsync({ id: req.id }), t('detail.withdrawn', 'Request withdrawn'))} />
      <ConfirmDialog open={dialog?.kind === 'retry'} title={t('detail.retry', 'Create the transfer again')} confirmLabel={t('detail.retry', 'Create the transfer again')}
        description={<SelectField label={t('detail.source', 'Warehouse the material leaves from')} required value={source} onChange={setSource} fullWidth
          options={[{ value: '', label: t('detail.chooseSource', 'Choose a warehouse') }, ...retrySourceOptions]} />}
        confirmDisabled={!source} loading={m.retryTransfer.isPending} error={dialogError} onCancel={close}
        onConfirm={() => void run(() => m.retryTransfer.mutateAsync({ id: req.id, sourceWarehouseId: source }), t('detail.retried', 'Transfer draft created'))} />
    </div>
  );
};
export default MaterialRequestDetailPage;
