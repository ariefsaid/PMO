import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ReasonDialog, StatusPill, useToast } from '@/src/components/ui';
import { useLeaveMutations } from '@/src/hooks/useLeave';
import type { LeaveRequestRow } from '@/src/lib/repositories/leave';
import { formatDay } from '@/src/lib/format';
import { leaveErrorMessage } from './leaveErrors';

const PILL: Record<LeaveRequestRow['status'], 'warn' | 'won' | 'lost' | 'neutral'> = {
  Pending: 'warn', Approved: 'won', Rejected: 'lost', Cancelled: 'neutral',
};

/** Requests with the actions the database says the viewer may take (`can_decide`, `is_mine`). UX only: the RPC decides. */
export const LeaveRequestList: React.FC<{ rows: LeaveRequestRow[] }> = ({ rows }) => {
  const { t } = useTranslation('crews');
  const { toast } = useToast();
  const { decide, cancel } = useLeaveMutations();
  const [rejecting, setRejecting] = useState<LeaveRequestRow | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setProblem(null);
    try { await fn(); toast(done, undefined, 'success'); } catch (err) { setProblem(leaveErrorMessage(t, err)); }
  };
  const statusLabel: Record<LeaveRequestRow['status'], string> = {
    Pending: t('crews:leave.status.pending', 'Pending'), Approved: t('crews:leave.status.approved', 'Approved'),
    Rejected: t('crews:leave.status.rejected', 'Rejected'), Cancelled: t('crews:leave.status.cancelled', 'Cancelled'),
  };
  return (
    <>
      {problem && <p role="alert" className="px-4 py-2 text-sm text-destructive-text">{problem}</p>}
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-sm" aria-label={`${r.person_name}, ${r.type_name}`}>
            <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
              <div className="font-medium text-foreground">{r.person_name} · {r.type_name}</div>
              <div className="text-muted-foreground">
                {r.start_date === r.end_date ? formatDay(r.start_date) : `${formatDay(r.start_date)} – ${formatDay(r.end_date)}`}
                {' · '}{t('crews:leave.days', '{{count}} days', { count: r.days })}
              </div>
              {r.reason && <div className="text-muted-foreground">{r.reason}</div>}
              {r.decision_note && <div className="text-muted-foreground">{t('crews:leave.note', 'Note: {{note}}', { note: r.decision_note })}</div>}
            </div>
            <StatusPill variant={PILL[r.status]}>{statusLabel[r.status]}</StatusPill>
            {r.can_decide && (
              <>
                <Button variant="primary" size="sm" onClick={() => void run(() => decide.mutateAsync({ id: r.id, decision: 'Approved', note: null }), t('crews:leave.approved', 'Leave approved'))}>
                  {t('crews:leave.approve', 'Approve')}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setRejecting(r)}>{t('crews:leave.reject', 'Reject')}</Button>
              </>
            )}
            {r.is_mine && r.status === 'Pending' && (
              <Button variant="ghost" size="sm" onClick={() => void run(() => cancel.mutateAsync(r.id), t('crews:leave.cancelled', 'Request cancelled'))}>
                {t('crews:leave.cancel', 'Cancel request')}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <ReasonDialog open={rejecting !== null} kind="reject" subject={t('crews:leave.subject', 'leave request')}
        loading={decide.isPending} onCancel={() => setRejecting(null)}
        onConfirm={(note) => {
          const r = rejecting;
          setRejecting(null);
          if (r) void run(() => decide.mutateAsync({ id: r.id, decision: 'Rejected', note }), t('crews:leave.rejected', 'Leave rejected'));
        }} />
    </>
  );
};
