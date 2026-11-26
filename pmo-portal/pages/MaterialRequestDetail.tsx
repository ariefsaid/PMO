import { ReservationsSlot } from '@/src/components/stock/ReservationsSlot';
import { RequestBorrowingNotice } from '@/src/components/stock/RequestBorrowingNotice';
import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { FollowUpTaskButton } from '@/src/components/tasks/FollowUpTaskButton';
import { Button, ConfirmDialog, DataTable, ListState, MobileActionBar, ReasonDialog, RecordHeader, RecordMenu, RecordSection, RecordStack, SelectField, cn, useToast, type Column } from '@/src/components/ui';
import { BackBar } from '@/src/components/shell';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { useDeliveryNoteSettings, useMaterialRequest, useMaterialRequestMutations, useStepPins, useWaitingForMe } from '@/src/hooks/useMaterialRequests';
import { useBuiltInRoleName } from '@/src/hooks/useOrgRoleNames';
import { waitingForText } from '@/src/lib/approvals/waitingFor';
import { useStockItems, useStockKeepers, useStockUnits, useStockWarehouses } from '@/src/hooks/useStock';
import { formatQuantity } from '@/src/lib/stockFormat';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import { formatDay } from '@/src/lib/format';
import { RequestStatusPill, RequestWorkOrder, StepStatusPill } from './materialRequests/shared';
import { useLabels, useRefusalText, useUserNames } from './materialRequests/useMaterialRequestText';
import { UsageWarning } from './materialRequests/UsageWarning';
import { useUsageThresholds } from '@/src/hooks/useUsageThresholds';
import type { MaterialRequestLine as RequestLine } from '@/src/lib/repositories/materialRequests';

type Dialog = null | { kind: 'return' | 'reject' } | { kind: 'approve' } | { kind: 'withdraw' } | { kind: 'retry' };

/** One request: the chain and who acted, the lines against plan, the decision controls, and the link to the transfer draft. */
const MaterialRequestDetailPage: React.FC = () => {
  // Both catalogues load before first paint: the approve dialog and the stock pickers render `stock` text, and a namespace that is
  // still loading when the dialog opens suspends the route and re-mounts this page, losing the open dialog (#2685, SPA arrival).
  const { t } = useTranslation(['materialRequests', 'stock']);
  const { t: tc } = useTranslation('common');
  const { requestId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { currentUser } = useAuth();
  const may = usePermission();
  const refusal = useRefusalText();
  const name = useUserNames();
  const labels = useLabels();
  const roleName = useBuiltInRoleName();
  const q = useMaterialRequest(requestId);
  const usage = useUsageThresholds();
  const waiting = useWaitingForMe();
  const { data: dnSettings } = useDeliveryNoteSettings();
  const { data: items } = useStockItems(true);
  const { data: units } = useStockUnits(true);
  const { data: warehouses } = useStockWarehouses();
  const { data: keepers } = useStockKeepers();
  const m = useMaterialRequestMutations();
  const pins = useStepPins(q.data?.projectId);
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
  const unitOf = (itemId: string) => { const unitId = items?.find((x) => x.id === itemId)?.unit_id; return units?.find((u) => u.id === unitId)?.code ?? ''; };
  const qty = (n: number | null | undefined, itemId: string, over = false) => n === null || n === undefined
    ? <span className="text-muted-foreground">—</span>
    : <span className={cn('whitespace-nowrap tabular-nums', over && 'font-medium text-warning-foreground')}>{formatQuantity(String(n), getNumberLocale())}{unitOf(itemId) && <span className="font-normal text-muted-foreground"> {unitOf(itemId)}</span>}</span>;
  // One row per item: the requested quantity, then the plan it is judged against, what was requested before and the new
  // total, each in its own right-aligned column. Where the plan comes from, the over-plan reason and a usage warning sit under the item.
  const lineColumns: Column<RequestLine>[] = [
    { key: 'item', header: t('form.item', 'Item'), rowHeader: true, cell: (l) => <div className="min-w-0 space-y-1" data-testid="mrq-detail-line">
      <span className="block break-words font-medium text-foreground">{itemName(l.itemId)}</span>
      {l.planQty !== null && l.planSource && <span className="block text-control font-normal text-muted-foreground" data-testid="mrq-detail-plan-source">{t(`form.planSource.${l.planSource}`, { standard: 'From usage standards', adjusted: 'Adjusted by the planner', allowance: 'From material allowance', none: 'No plan' }[l.planSource])}</span>}
      {l.overPlanReason && <span className="block break-words text-control font-normal text-foreground">{t('detail.overPlanReason', 'Over plan: {{reason}}', { reason: l.overPlanReason })}</span>}
      {l.planQty !== null && <span className="block font-normal"><UsageWarning line={{ planQty: l.planQty, priorQty: l.priorQty ?? 0, quantity: l.quantity }} thresholds={usage.thresholds} /></span>}
    </div> },
    { key: 'quantity', header: t('detail.requested', 'Requested'), align: 'num', size: 136, cell: (l) => qty(l.quantity, l.itemId) },
    { key: 'plan', header: t('form.figures.plan', 'Plan'), align: 'num', size: 136, cell: (l) => qty(l.planQty, l.itemId) },
    { key: 'prior', header: t('form.figures.prior', 'Requested before'), align: 'num', size: 152, cell: (l) => (l.planQty === null ? null : qty(l.priorQty ?? 0, l.itemId)) },
    { key: 'total', header: t('form.figures.total', 'New total'), align: 'num', size: 136, cell: (l) => (l.planQty === null ? null : qty((l.priorQty ?? 0) + l.quantity, l.itemId, (l.priorQty ?? 0) + l.quantity > l.planQty)) },
  ];
  const sourceWarehouses = (warehouses ?? []).filter((w) => w.kind === 'central' && !w.archived_at);
  const retrySourceOptions = sourceWarehouses
    .filter((w) => may('create', 'stockDocument', { record: { isKeeper: keepers?.some((k) => k.warehouse_id === w.id && k.user_id === currentUser?.id) ?? false } }))
    .map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }));
  // The retry RPC refuses both the author and anyone who is not a source-warehouse keeper or Admin.
  const canRetryTransfer = req.status === 'approved' && (!req.transferDocumentId || req.transferCancelled) &&
    req.createdBy !== currentUser?.id && retrySourceOptions.length > 0;
  // Final approval records the decision alone; the keeper picks the warehouse and sends next (FR-MRQ-011).
  const waitingOnKeeper = req.status === 'approved' && !req.transferDocumentId;
  const noApprover = req.status === 'pending' && !open;
  // fix-waiting item 3: who the open step waits for. A pinned person is named; otherwise the step's role.
  const pinned = open ? (pins.data ?? []).find((pin) => pin.position === open.position) : undefined;
  // FR-TR-010: an unpinned step shows its built-in job role through the org's rename, or its localised access level.
  // A pinned step keeps the named person and its label, so no role is invented for them.
  const openRole = open ? (open.jobRole ? roleName(open.jobRole) : labels.role[open.role] ?? open.role) : '';
  const waitingLine = req.status === 'pending' && open
    ? waitingForText({ names: pinned ? [name(pinned.approverId)] : [], role: pinned ? open.label : `${open.label} · ${openRole}`, step: { n: open.position, of: last } }, tc)
    : null;
  const canPrintDeliveryNote = Boolean(dnSettings?.enabled) && (req.status === 'approved' || req.status === 'fulfilled');

  const close = () => { setDialog(null); setDialogError(null); };
  const run = async (work: () => Promise<unknown>, success: string) => {
    setDialogError(null);
    try { await work(); toast(success, req.number, 'success'); close(); }
    catch (err) { setDialogError(refusal(err)); }
  };
  const decide = (decision: 'approve' | 'return' | 'reject', reason?: string) => run(
    () => m.decide.mutateAsync({ id: req.id, position: open!.position, decision, reason, sourceWarehouseId: decision === 'approve' && needsSource && source ? source : null }),
    decision === 'approve' ? t('detail.approved', 'Step approved') : decision === 'return' ? t('detail.returned', 'Sent back to the requester') : t('detail.rejected', 'Request rejected'));

  const menuItems = [
    ...(canDecide ? [
      { key: 'return', label: t('detail.return', 'Send back'), onSelect: () => setDialog({ kind: 'return' } as const) },
      { key: 'reject', label: t('detail.reject', 'Reject'), onSelect: () => setDialog({ kind: 'reject' } as const) }] : []),
    ...(canWithdraw ? [{ key: 'withdraw', label: t('detail.withdraw', 'Withdraw request'), onSelect: () => setDialog({ kind: 'withdraw' } as const) }] : []),
    ...(canPrintDeliveryNote ? [{ key: 'printDeliveryNote', label: t('detail.printDeliveryNote', 'Print delivery note'), onSelect: () => navigate(`/material-requests/${req.id}/delivery-note`) }] : []),
  ];

  return (
    <div>
      <div className="hidden max-[920px]:block"><BackBar label={t('form.back', 'Material requests')} onBack={() => navigate('/material-requests')} /></div>
      <RecordHeader panelInset name={req.number} status={<RequestStatusPill status={req.status} />}
        meta={<span>{t('detail.meta', 'Raised by {{name}} · needed by {{date}}', { name: name(req.createdBy), date: formatDay(req.neededBy) })}</span>}
        primaryAction={canDecide ? <MobileActionBar className="fixed inset-x-0 bottom-[var(--phone-nav-height)] z-20 flex gap-2 border-t border-border bg-card p-3 sm:static sm:z-auto sm:border-0 sm:bg-transparent sm:p-0"><Button variant="primary" onClick={() => setDialog({ kind: 'approve' })}>{t('detail.approve', 'Approve')}</Button><RecordMenu items={menuItems} ariaLabel={t('detail.moreActions', 'More actions')} /></MobileActionBar>
          : canEdit ? <Button variant="primary" onClick={() => navigate(`/material-requests/${req.id}/edit`)}>{t('detail.edit', 'Edit and send')}</Button>
          : canPrintDeliveryNote ? <Button variant="outline" onClick={() => navigate(`/material-requests/${req.id}/delivery-note`)}>{t('detail.printDeliveryNote', 'Print delivery note')}</Button>
          : undefined}
        menuItems={canDecide ? [] : menuItems} menuLabel={t('detail.moreActions', 'More actions')}>
        <p><span className="text-muted-foreground">{t('list.columns.workOrder', 'Work order')}: </span><RequestWorkOrder workOrderId={req.workOrderId} projectId={req.projectId} /></p>
        {req.note && <p>{req.note}</p>}
        <div><FollowUpTaskButton type="material_request" recordId={req.id} projectId={req.projectId} defaultName={req.number} finished={['fulfilled', 'rejected', 'cancelled'].includes(req.status)} /></div>
      </RecordHeader>

      <RecordStack>
        <ReservationsSlot><RequestBorrowingNotice requestId={req.id} /></ReservationsSlot>
        {req.transferDocumentId && (
          <RecordSection title={t('detail.transfer', 'Delivery')}>
            <p>
              {req.status === 'fulfilled' ? t('detail.transferPosted', 'The stock keeper has posted the transfer.') : t('detail.transferDraft', 'A transfer draft is ready for the stock keeper to post.')}{' '}
              <Link to={`/stock/documents/${req.transferDocumentId}`} className="font-medium text-primary-text hover:underline">{t('detail.openTransfer', 'Open the delivery document')}</Link>
            </p>
            {req.transferCancelled && <p role="status" className="text-warning-foreground">{t('detail.transferCancelled', 'The transfer was cancelled. The request is still approved.')}</p>}
          </RecordSection>
        )}
        {(canRetryTransfer || waitingOnKeeper) && (
          <RecordSection title={t('detail.transfer', 'Delivery')}>
            {waitingOnKeeper && <p role="status">{canRetryTransfer ? t('detail.keeperNext', 'Approved. Choose the warehouse and send the stock.') : t('detail.keeperWaiting', 'Approved. The stock keeper chooses the warehouse and sends the stock next.')}</p>}
            {canRetryTransfer && <Button variant="outline" onClick={() => setDialog({ kind: 'retry' })}>{waitingOnKeeper ? t('detail.chooseAndSend', 'Choose warehouse and send') : t('detail.retry', 'Create the transfer again')}</Button>}
          </RecordSection>
        )}

        <RecordSection title={t('detail.chain', 'Approval')}>
 {waitingLine && <p role="status" data-testid="mrq-waiting-for" className="mb-2 font-medium">{waitingLine}</p>}
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

        <RecordSection title={t('detail.lines', 'Items')} flush>
          <DataTable<RequestLine> rows={req.lines} columns={lineColumns} rowKey={(l) => l.id} tableId="material-request-lines" accessibleName={t('detail.lines', 'Items')} embedded cardValuesEnd />
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
          ? (retrySourceOptions.length > 0
            ? <SelectField label={t('detail.sourceOptional', 'Warehouse the material leaves from (optional)')} value={source} onChange={setSource} fullWidth
                options={[{ value: '', label: t('detail.leaveToKeeper', 'Leave it to the stock keeper') }, ...retrySourceOptions]} helper={t('detail.sourceHelp', 'Leave this empty and the stock keeper chooses the warehouse and sends the stock. If you choose one, the transfer is created as a draft.')} />
            : t('detail.finalBody', 'Approving records your decision. The stock keeper chooses the warehouse and sends the stock.'))
          : t('detail.approveBody', 'Approve step {{n}} of {{number}}.', { n: open?.position, number: req.number })}
        loading={m.decide.isPending} error={dialogError} onCancel={close} onConfirm={() => void decide('approve')} />
      <ReasonDialog open={dialog?.kind === 'return' || dialog?.kind === 'reject'} kind={dialog?.kind === 'reject' ? 'reject' : 'return'}
        subject={t('detail.subject', 'material request')} loading={m.decide.isPending} error={dialogError} onCancel={close}
        onConfirm={(reason) => void decide(dialog?.kind === 'reject' ? 'reject' : 'return', reason)} />
      <ConfirmDialog open={dialog?.kind === 'withdraw'} tone="destructive" title={t('detail.withdrawTitle', 'Withdraw this request')} confirmLabel={t('detail.withdraw', 'Withdraw request')}
        description={t('detail.withdrawBody', 'The request is cancelled and its approvers are no longer asked.')} loading={m.cancel.isPending} error={dialogError}
        onCancel={close} onConfirm={() => void run(() => m.cancel.mutateAsync({ id: req.id }), t('detail.withdrawn', 'Request withdrawn'))} />
      <ConfirmDialog open={dialog?.kind === 'retry'} title={waitingOnKeeper ? t('detail.chooseAndSend', 'Choose warehouse and send') : t('detail.retry', 'Create the transfer again')}
        confirmLabel={waitingOnKeeper ? t('detail.chooseAndSend', 'Choose warehouse and send') : t('detail.retry', 'Create the transfer again')}
        description={<SelectField label={t('detail.source', 'Warehouse the material leaves from')} required value={source} onChange={setSource} fullWidth
          options={[{ value: '', label: t('detail.chooseSource', 'Choose a warehouse') }, ...retrySourceOptions]} />}
        confirmDisabled={!source} loading={m.retryTransfer.isPending} error={dialogError} onCancel={close}
        onConfirm={() => void run(() => m.retryTransfer.mutateAsync({ id: req.id, sourceWarehouseId: source }), t('detail.retried', 'Transfer draft created'))} />
    </div>
  );
};
export default MaterialRequestDetailPage;
