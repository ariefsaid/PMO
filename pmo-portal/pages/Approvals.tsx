import React from 'react';
import Card from '../components/Card';
import TimesheetStatusBadge from '../components/TimesheetStatusBadge';
import { TimesheetStatus } from '../types';
import { ClipboardDocumentCheckIcon } from '../components/icons';
import { useTimesheetsAwaitingApproval, useTimesheetMutations } from '@/src/hooks/useTimesheetApproval';
import { timesheetActions } from '@/src/lib/db/timesheetTransition';
import type { TimesheetAwaitingApproval } from '@/src/lib/db/timesheetTransition';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sumHours(sheet: TimesheetAwaitingApproval): number {
  return sheet.entries.reduce((sum, e) => sum + e.hours, 0);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const ApprovalsPage: React.FC = () => {
  const { data: queue, isPending, isError, refetch } = useTimesheetsAwaitingApproval();
  const { approve, reject } = useTimesheetMutations();

  // --- Loading ---
  if (isPending) {
    return (
      <Card>
        <div data-testid="approvals-loading" className="animate-pulse space-y-4">
          <div className="h-8 w-64 bg-gray-200 dark:bg-gray-700 rounded" />
          <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded-xl" />
          <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded-xl" />
        </div>
      </Card>
    );
  }

  // --- Error ---
  if (isError) {
    return (
      <Card>
        <div className="text-center py-16 border-2 border-dashed border-red-200 dark:border-red-800 rounded-xl">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white">
            Couldn't load approval queue
          </h3>
          <p className="mt-1 text-gray-500 dark:text-gray-400">
            Something went wrong fetching timesheets awaiting approval.
          </p>
          <button
            onClick={() => refetch()}
            className="mt-4 text-primary-600 hover:text-primary-500 font-medium text-sm"
          >
            Retry
          </button>
        </div>
      </Card>
    );
  }

  // --- Empty ---
  if (!queue || queue.length === 0) {
    return (
      <Card>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <ClipboardDocumentCheckIcon className="w-6 h-6 text-primary-500" />
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">Approval Queue</h2>
          </div>
          <div
            data-testid="approvals-empty"
            className="text-center py-16 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl"
          >
            <ClipboardDocumentCheckIcon className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">
              No timesheets awaiting approval
            </h3>
            <p className="mt-1 text-gray-500 dark:text-gray-400">
              All submitted timesheets have been reviewed.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  // --- Data ---
  return (
    <Card className="min-h-[calc(100vh-140px)]">
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <ClipboardDocumentCheckIcon className="w-6 h-6 text-primary-500" />
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            Approval Queue
            <span className="ml-2 text-sm font-normal text-gray-500 dark:text-gray-400">
              ({queue.length} pending)
            </span>
          </h2>
        </div>

        <div className="space-y-4">
          {queue.map(sheet => {
            const totalHours = sumHours(sheet);
            // isOwner=false because this is the approver's queue (own sheets excluded by DAL)
            const actions = timesheetActions(
              sheet.status as TimesheetStatus,
              false,
              true,
            );

            return (
              <div
                key={sheet.id}
                className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm p-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  {/* Sheet info */}
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900 dark:text-white">
                        {sheet.owner?.full_name ?? 'Unknown'}
                      </span>
                      <TimesheetStatusBadge status={sheet.status as TimesheetStatus} />
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Week of{' '}
                      <span className="font-medium text-gray-700 dark:text-gray-300">
                        {sheet.week_start_date}
                      </span>
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Total:{' '}
                      <span className="font-semibold text-gray-900 dark:text-white">
                        {totalHours.toFixed(1)} hrs
                      </span>
                    </p>
                  </div>

                  {/* Actions (cosmetically gated; RPC is the real authority) */}
                  {(actions.approve || actions.reject) && (
                    <div className="flex gap-2">
                      {actions.approve && (
                        <button
                          onClick={() => approve.mutate({ id: sheet.id })}
                          disabled={approve.isPending}
                          className="px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed rounded-md shadow-sm transition-colors"
                        >
                          Approve
                        </button>
                      )}
                      {actions.reject && (
                        <button
                          onClick={() => reject.mutate({ id: sheet.id })}
                          disabled={reject.isPending}
                          className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed rounded-md shadow-sm transition-colors"
                        >
                          Reject
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
};

export default ApprovalsPage;
