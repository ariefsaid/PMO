import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ListState, useToast } from '@/src/components/ui';
import { describePushMutationError } from '@/src/lib/adapterSeam/pushErrorCopy';
import { usePermission } from '@/src/auth/usePermission';
import { usePushesNeedingAttention } from '@/src/hooks/useTimesheetApproval';
import { useAuth } from '@/src/auth/useAuth';
import { weekLabel } from '../timesheets/TimesheetBulkApprove';
import { PushStateBadge } from '@/src/components/timesheets/PushStateBadge';

/**
 * P3b (FR-TSP-085) — the "needs attention" ERP-push queue. Every `failed`/`held` push visible to the
 * caller (RLS is the only scoping authority, task 4.x). NOTHING renders when the list is empty — an
 * unflipped org, or one with no failures, sees no trace of this section (FR-TSP-173).
 */
export function PushAttentionSection() {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const may = usePermission();
  const { toast } = useToast();
  const { data, isPending, isError, refetch, retry: retryMutation } = usePushesNeedingAttention();
  const [retryingId, setRetryingId] = useState<string | null>(null);

  if (isError) {
    return (
      <section
        className="mb-4"
        aria-label={t('approvals.pushAttention.title', 'ERP pushes needing attention')}
      >
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {t('approvals.pushAttention.title', 'ERP pushes needing attention')}
        </h2>
        <ListState
          variant="error"
          title={t('approvals.queue.loadError', "Couldn't load {{queue}}", {
            queue: t('approvals.pushAttention.title', 'ERP pushes needing attention').toLowerCase(),
          })}
          sub={t('approvals.queue.loadErrorSub', 'Try again to refresh this queue.')}
          onRetry={() => {
            void refetch();
          }}
        />
      </section>
    );
  }

  if (isPending || !data || data.length === 0) return null;

  return (
    <section
      className="mb-4"
      aria-label={t('approvals.pushAttention.title', 'ERP pushes needing attention')}
    >
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        {t('approvals.pushAttention.title', 'ERP pushes needing attention')}
      </h2>
      <div className="space-y-1.5">
        {data.map((row) => {
          const canRetry = may('push_timesheet', 'timesheet', {
            currentUserId: currentUser?.id,
            record: { approved_by: row.approved_by },
          });
          return (
            <div
              key={row.timesheet_id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2.5"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium">{row.owner_name}</div>
                <div className="mt-0.5 text-[12px] text-muted-foreground">
                  {weekLabel(row.week_start_date, t)}
                </div>
              </div>
              <PushStateBadge
                state={{ push_state: row.push_state, push_error: row.push_error, ts_number: row.ts_number }}
                canRetry={canRetry}
                retryLoading={retryingId === row.timesheet_id && retryMutation.isPending}
                // ⚑ I-13 (rendered Discover pass, 2026-07-22) — this Retry gave ZERO feedback: no
                // toast, no state change, no console error, while the budget surface's Retry two
                // screens away toasts both outcomes. A silent retry is indistinguishable from a dead
                // button, so an operator either gives up or clicks it repeatedly. BOTH outcomes are
                // now stated, at the call site that knows which row they belong to.
                onRetry={() => {
                  setRetryingId(row.timesheet_id);
                  retryMutation.mutate(
                    { timesheetId: row.timesheet_id },
                    {
                      onSuccess: () =>
                        toast(
                          t('approvals.pushAttention.retrySuccess', 'Timesheet pushed to ERPNext'),
                          `${row.owner_name} · ${weekLabel(row.week_start_date, t)}`,
                          'success',
                        ),
                      // ⚑ NEW-2 (rendered re-verification, 2026-07-22) — I-13 gave this Retry a
                      // voice and gave it the WRONG one. `classifyMutationError` is the generic CRUD
                      // classifier: it passes the server's message through as `detail`, so the toast
                      // read "That timesheet could not be pushed — timesheet-not-approved (status
                      // Submitted)" — a raw adapter token on an operator surface, the precise thing
                      // `pushErrorCopy` exists to prevent and which the badge two lines above already
                      // obeys. A push failure is translated by the push vocabulary, on EVERY path.
                      onError: (err) => {
                        const copy = describePushMutationError(err);
                        toast(
                          t(
                            'approvals.pushAttention.retryFailure',
                            'That timesheet could not be pushed',
                          ),
                          copy.remedy ? `${copy.message} ${copy.remedy}` : copy.message,
                          'warning',
                        );
                      },
                      onSettled: () => setRetryingId(null),
                    },
                  );
                }}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
