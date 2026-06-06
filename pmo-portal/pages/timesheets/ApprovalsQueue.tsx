import React from 'react';
import {
  ApprovalRow,
  Button,
  GateNotice,
  Icon,
  ListState,
  StatusPill,
  type StatusVariant,
} from '@/src/components/ui';
import { TimesheetStatus } from '../../types';
import { useTimesheetsAwaitingApproval, useTimesheetMutations } from '@/src/hooks/useTimesheetApproval';
import { timesheetActions } from '@/src/lib/db/timesheetTransition';
import type { TimesheetAwaitingApproval } from '@/src/lib/db/timesheetTransition';

/** Sum a sheet's entry hours (entries are number-normalised at the DAL boundary). */
function sumHours(sheet: TimesheetAwaitingApproval): number {
  return sheet.entries.reduce((sum, e) => sum + e.hours, 0);
}

/** Map timesheet status → tinted StatusPill variant. */
const PILL: Record<string, StatusVariant> = {
  Draft: 'neutral',
  Submitted: 'open',
  Approved: 'won',
  Rejected: 'lost',
};

function weekLabel(weekStart: string): string {
  // weekStart is an ISO date (YYYY-MM-DD). Render "Week of Mon D" without TZ drift.
  const [y, m, d] = weekStart.split('-').map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  return `Week of ${dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

/**
 * The manager/admin approval queue — the Timesheets "Approvals queue" toggle
 * body, and the body of the preserved legacy `/approvals` route. The SoD gate
 * is state-driven from the real role/identity: the awaiting-approval DAL excludes
 * the caller's own sheets, and `timesheetActions` never offers approve/reject on
 * an owned sheet. The RPC is the authoritative SoD enforcer; this gates affordances.
 */
export const ApprovalsQueue: React.FC = () => {
  const { data: queue, isPending, isError, refetch } = useTimesheetsAwaitingApproval();
  const { approve, reject } = useTimesheetMutations();

  if (isPending) {
    return (
      <div className="rounded-lg border border-border bg-card" data-testid="approvals-loading">
        <ListState variant="loading" rows={4} />
      </div>
    );
  }

  if (isError) {
    return (
      <ListState
        variant="error"
        title="Couldn't load the approval queue"
        sub="Something went wrong fetching timesheets awaiting your approval."
        onRetry={() => refetch()}
      />
    );
  }

  const sheets = queue ?? [];

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center gap-2.5">
        <h2 className="text-sm font-semibold">Team approvals queue</h2>
        <span className="flex-1" />
        {sheets.length > 0 && (
          <StatusPill variant="overdue" aria-label={`${sheets.length} awaiting you`}>
            {sheets.length} awaiting you
          </StatusPill>
        )}
      </div>

      <GateNotice variant="blocked" className="mb-3">
        <b>Separation of duties.</b> You cannot approve your own timesheet — only a line manager can
        approve, and never their own week. Approving a week is a single action.
      </GateNotice>

      {sheets.length === 0 ? (
        <div data-testid="approvals-empty">
          <ListState
            variant="empty"
            icon="check"
            title="Nothing awaiting you"
            sub="Submitted timesheets from your reports will appear here for review."
          />
        </div>
      ) : (
        <div>
          {sheets.map((sheet) => {
            const total = sumHours(sheet);
            // isOwner=false: the queue already excludes the caller's own sheets (SoD).
            const actions = timesheetActions(sheet.status as TimesheetStatus, false, true);
            return (
              <ApprovalRow
                key={sheet.id}
                name={sheet.owner?.full_name ?? 'Unknown'}
                week={weekLabel(sheet.week_start_date)}
                hours={total}
                status={
                  <StatusPill variant={PILL[sheet.status] ?? 'neutral'}>{sheet.status}</StatusPill>
                }
              >
                {actions.approve && (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => approve.mutate({ id: sheet.id })}
                    loading={approve.isPending}
                  >
                    <Icon name="check" />
                    Approve
                  </Button>
                )}
                {actions.reject && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => reject.mutate({ id: sheet.id })}
                    loading={reject.isPending}
                  >
                    Return
                  </Button>
                )}
              </ApprovalRow>
            );
          })}
        </div>
      )}
    </section>
  );
};
