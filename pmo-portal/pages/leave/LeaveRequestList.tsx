import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, DataTable, Drawer, ReasonDialog, StatusPill, useToast, type Column } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useLeaveMutations } from '@/src/hooks/useLeave';
import type { LeaveRequestRow } from '@/src/lib/repositories/leave';
import { formatDay, formatNumberExact } from '@/src/lib/format';
import { useLeaveErrorText } from '../crews/crewErrors';

const PILL: Record<LeaveRequestRow['status'], 'warn' | 'won' | 'lost' | 'neutral'> = {
  Pending: 'warn', Approved: 'won', Rejected: 'lost', Cancelled: 'neutral',
};

const range = (r: LeaveRequestRow) => (r.start_date === r.end_date ? formatDay(r.start_date) : `${formatDay(r.start_date)} – ${formatDay(r.end_date)}`);

/**
 * Leave requests as one table (#2708). A row scans person, type, dates, days and state; the row opens a side drawer with the
 * reason, who decides or decided, the decision note and the actions. `decide` lists requests waiting on the viewer: Approve and
 * Reject sit on the row. The actions are those the database says the viewer may take (`can_decide`, `is_mine`). UX only: the RPC decides.
 */
export const LeaveRequestList: React.FC<{ rows: LeaveRequestRow[]; tableId: string; decide?: boolean }> = ({ rows, tableId, decide: deciding = false }) => {
  const { t } = useTranslation('crews');
  const writeError = useLeaveErrorText();
  const { toast } = useToast();
  const { decide, cancel } = useLeaveMutations();
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  // can() AND the row flag from the database: the screen may be stricter than the RPC, never looser.
  const record = { viewOnly: realRole !== effectiveRole };
  const canDecide = may('decide', 'leaveRequest', { record });
  const canCancel = may('cancel', 'leaveRequest', { record });
  const [rejecting, setRejecting] = useState<LeaveRequestRow | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const open = rows.find((r) => r.id === openId) ?? null;
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setProblem(null);
    try { await fn(); toast(done, undefined, 'success'); } catch (err) { setProblem(writeError(err)); }
  };
  const statusLabel: Record<LeaveRequestRow['status'], string> = {
    Pending: t('crews:leave.status.pending', 'Pending'), Approved: t('crews:leave.status.approved', 'Approved'),
    Rejected: t('crews:leave.status.rejected', 'Rejected'), Cancelled: t('crews:leave.status.cancelled', 'Cancelled'),
  };
  const mayDecide = (r: LeaveRequestRow) => r.can_decide && canDecide;
  const mayCancel = (r: LeaveRequestRow) => r.is_mine && r.status === 'Pending' && canCancel;
  const approve = (r: LeaveRequestRow) => void run(() => decide.mutateAsync({ id: r.id, decision: 'Approved', note: null }), t('crews:leave.approved', 'Leave approved'));
  const cancelRequest = (r: LeaveRequestRow) => void run(() => cancel.mutateAsync(r.id), t('crews:leave.cancelled', 'Request cancelled'));
  // Who the request is with: the deciders while pending, the decider once decided.
  const decider = (r: LeaveRequestRow) => {
    if (r.status === 'Pending') return r.waiting_for_names.length ? r.waiting_for_names.join(', ') : t('crews:leave.noDecider', 'No approver');
    return (r.status === 'Approved' || r.status === 'Rejected') ? r.decided_by_name : null;
  };
  const decideButtons = (r: LeaveRequestRow) => (mayDecide(r) ? (
    <span className="inline-flex gap-2">
      <Button variant="outline" size="sm" onClick={() => setRejecting(r)}>{t('crews:leave.reject', 'Reject')}</Button>
      <Button variant="primary" size="sm" onClick={() => approve(r)}>{t('crews:leave.approve', 'Approve')}</Button>
    </span>
  ) : null);
  const columns: Column<LeaveRequestRow>[] = [
    { key: 'person', header: t('crews:person', 'Person'), kind: 'primary', rowHeader: true, cell: (r) => r.person_name },
    { key: 'type', header: t('crews:leave.type', 'Type'), cell: (r) => r.type_name },
    { key: 'dates', header: t('crews:leave.dates', 'Dates'), kind: 'date', cell: range },
    { key: 'days', header: t('crews:leave.daysHeader', 'Days'), kind: 'number', cell: (r) => formatNumberExact(r.days) },
    ...(deciding
      ? [{ key: 'reason', header: t('crews:reason', 'Reason'), kind: 'meta' as const, cell: (r: LeaveRequestRow) => r.reason }]
      : [
          { key: 'with', header: t('crews:leave.decider', 'Decider'), kind: 'meta' as const, cell: decider },
          { key: 'status', header: t('crews:statusHeader', 'Status'), kind: 'status' as const,
            cell: (r: LeaveRequestRow) => <StatusPill variant={PILL[r.status]}>{statusLabel[r.status]}</StatusPill> },
        ]),
    ...(deciding ? [{ key: 'decide', header: <span className="sr-only">{t('crews:leave.decision', 'Decision')}</span>, kind: 'actions' as const, cell: decideButtons }] : []),
  ];
  return (
    <>
      {problem && <p role="alert" className="px-4 py-2 text-sm text-destructive-text">{problem}</p>}
      <DataTable<LeaveRequestRow> embedded rows={rows} columns={columns} rowKey={(r) => r.id} tableId={tableId}
        onActivate={(r) => setOpenId(r.id)}
        rowLabel={(r) => t('crews:leave.openRow', 'Open the leave of {{name}}', { name: r.person_name })}
        rowMenu={(r) => (mayCancel(r) ? [{ label: t('crews:leave.cancel', 'Cancel request'), onClick: () => cancelRequest(r) }] : [])} />
      <Drawer open={open !== null} onClose={() => setOpenId(null)}
        title={open ? `${open.person_name} · ${open.type_name}` : ''}
        status={open ? <StatusPill variant={PILL[open.status]}>{statusLabel[open.status]}</StatusPill> : undefined}
        footer={open && (mayDecide(open) || mayCancel(open)) ? (
          <div className="flex flex-wrap justify-end gap-2">
            {mayCancel(open) && <Button variant="ghost" onClick={() => { cancelRequest(open); setOpenId(null); }}>{t('crews:leave.cancel', 'Cancel request')}</Button>}
            {mayDecide(open) && <Button variant="outline" onClick={() => setRejecting(open)}>{t('crews:leave.reject', 'Reject')}</Button>}
            {mayDecide(open) && <Button variant="primary" onClick={() => { approve(open); setOpenId(null); }}>{t('crews:leave.approve', 'Approve')}</Button>}
          </div>
        ) : undefined}>
        {open && (
          <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-3 text-sm">
            <dt className="text-muted-foreground">{t('crews:leave.dates', 'Dates')}</dt>
            <dd className="text-foreground">{range(open)}</dd>
            <dt className="text-muted-foreground">{t('crews:leave.daysHeader', 'Days')}</dt>
            <dd className="tabular-nums text-foreground">{formatNumberExact(open.days)}</dd>
            {open.reason && <><dt className="text-muted-foreground">{t('crews:reason', 'Reason')}</dt><dd className="text-foreground">{open.reason}</dd></>}
            {open.status === 'Pending' && (
              <>
                <dt className="text-muted-foreground">{t('crews:leave.waitingForLabel', 'Waiting for')}</dt>
                <dd className="text-foreground">{open.waiting_for_names.length ? open.waiting_for_names.join(', ') : t('crews:leave.waitingNoDecider', 'No active approver is available.')}</dd>
              </>
            )}
            {open.decided_by_name && (open.status === 'Approved' || open.status === 'Rejected') && (
              <>
                <dt className="text-muted-foreground">{open.status === 'Approved' ? t('crews:leave.approvedByLabel', 'Approved by') : t('crews:leave.rejectedByLabel', 'Rejected by')}</dt>
                <dd className="text-foreground">{open.decided_by_name}</dd>
              </>
            )}
            {open.decision_note && <><dt className="text-muted-foreground">{t('crews:leave.noteLabel', 'Note')}</dt><dd className="text-foreground">{open.decision_note}</dd></>}
          </dl>
        )}
      </Drawer>
      <ReasonDialog open={rejecting !== null} kind="reject" subject={t('crews:leave.subject', 'leave request')}
        loading={decide.isPending} onCancel={() => setRejecting(null)}
        onConfirm={(note) => {
          const r = rejecting;
          setRejecting(null);
          setOpenId(null);
          if (r) void run(() => decide.mutateAsync({ id: r.id, decision: 'Rejected', note }), t('crews:leave.rejected', 'Leave rejected'));
        }} />
    </>
  );
};
