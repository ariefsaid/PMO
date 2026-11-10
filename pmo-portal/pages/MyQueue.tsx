import React, { useMemo } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Badge, ListState, StatusPill } from '@/src/components/ui';
import { useMyTasks } from '@/src/hooks/useMyTasks';
import { useOrgToday } from '@/src/hooks/useOrgToday';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useProcurements } from '@/src/hooks/useProcurements';
import { useTimesheetsAwaitingApproval } from '@/src/hooks/useTimesheetApproval';
import { useExpenseClaimsAwaitingDecision } from '@/src/hooks/useExpenseClaims';
import { useInvoicesAwaitingViewer } from '@/src/hooks/useInvoicesAwaitingViewer';
import { pendingProcurementApprovals } from '@/src/lib/selectors/approvals';
import { claimsAwaitingViewer } from '@/src/lib/expenses/expenseRules';
import { formatCurrency, formatCurrencyCents, formatDateOnly } from '@/src/lib/format';

/** Roles the Approvals page lets into the expense queue (see `pages/Approvals.tsx`). */
const EXPENSE_APPROVER_ROLES = ['Admin', 'Executive', 'Finance', 'Project Manager'];
/** How many tasks the Home list shows before pointing at the full My Tasks page. */
const TASK_PREVIEW_LIMIT = 6;

export interface MyQueueRow {
  key: string;
  /** Destination that owns the decision (record page or the approvals queue). */
  to: string;
  title: string;
  /** One muted context line: the kind of work and who/what it belongs to. */
  context: string;
  /** Right-aligned figure (money or a date); omitted when the record carries none. */
  value?: string;
}

/**
 * #2061 — the phone Home: "my queue".
 *
 * The signed-in user's own open tasks plus everything awaiting their approval, assembled from
 * the EXISTING hooks that `/my-tasks` and `/approvals` already read (`useMyTasks`,
 * `useProcurements` + `pendingProcurementApprovals`, `useTimesheetsAwaitingApproval`,
 * `useExpenseClaimsAwaitingDecision` + `claimsAwaitingViewer`, `useInvoicesAwaitingViewer`).
 * No new data path, no migration: this page only chooses what to show first.
 *
 * Approval reads mount only for a viewer whose role can decide something (the same gate the
 * Approvals page and the sidebar apply), so an Engineer's Home never asks for an approval queue
 * they cannot act on. Desktop keeps the executive dashboard as its landing; this page is reachable
 * by deep link at `/home`.
 */

/** The approval half of the queue. Mounted only when the viewer can approve, so its queries
 *  never run for a role that has no approvals. */
const MyApprovalsSection: React.FC = () => {
  const { t } = useTranslation('home');
  const { currentUser } = useAuth();
  const { realRole } = useEffectiveRole();
  const may = usePermission();
  const selfId = currentUser?.id;

  const canApproveProcurement = may('transition', 'procurement');
  const canApproveTimesheets = may('transition', 'approval');
  const canApproveInvoices = may('transition', 'salesInvoice');
  const canApproveExpenses = EXPENSE_APPROVER_ROLES.includes(realRole ?? '');

  const procurements = useProcurements({ status: 'Requested' });
  const timesheets = useTimesheetsAwaitingApproval();
  const expenses = useExpenseClaimsAwaitingDecision();
  const invoices = useInvoicesAwaitingViewer();

  const rows = useMemo<MyQueueRow[]>(() => {
    const next: MyQueueRow[] = [];
    if (canApproveProcurement) {
      for (const row of pendingProcurementApprovals(procurements.data, selfId, realRole === 'Admin')) {
        next.push({
          key: `procurement:${row.id}`,
          to: `/procurement/${row.id}`,
          title: row.title,
          context: t('queue.context.procurement', 'Procurement · {{vendor}}', {
            vendor: row.vendor?.name ?? t('queue.context.noVendor', 'No vendor'),
          }),
          value: formatCurrency(Number(row.total_value), row.currency),
        });
      }
    }
    if (canApproveTimesheets) {
      for (const sheet of timesheets.data ?? []) {
        next.push({
          key: `timesheet:${sheet.id}`,
          to: '/approvals?scope=timesheets',
          title: t('queue.timesheetTitle', 'Timesheet week of {{date}}', {
            date: formatDateOnly(sheet.week_start_date),
          }),
          context: t('queue.context.timesheet', 'Timesheet · {{name}}', {
            name: sheet.owner?.full_name ?? t('queue.context.noName', 'Team member'),
          }),
          value: t('queue.hours', '{{hours}} h', {
            hours: (sheet.entries ?? []).reduce((sum, entry) => sum + Number(entry.hours ?? 0), 0),
          }),
        });
      }
    }
    if (canApproveExpenses) {
      for (const entry of claimsAwaitingViewer(expenses.data ?? [], selfId, realRole)) {
        next.push({
          key: `expense:${entry.claim.id}`,
          to: `/expenses/${entry.claim.id}`,
          title: entry.claim.title,
          context: t('queue.context.expense', 'Expense claim · {{number}}', {
            number: entry.claim.claim_number ?? t('queue.context.noNumber', 'No number'),
          }),
          value: formatCurrencyCents(Number(entry.claim.amount), entry.claim.currency),
        });
      }
    }
    if (canApproveInvoices) {
      for (const invoice of invoices.rows) {
        next.push({
          key: `invoice:${invoice.id}`,
          to: `/sales-invoices/${invoice.id}`,
          title: invoice.si_number ?? t('queue.invoiceUntitled', 'Draft invoice'),
          context: t('queue.context.invoice', 'Customer invoice · {{customer}}', {
            customer: invoice.customer_name ?? t('queue.context.noCustomer', 'No customer'),
          }),
          value: invoice.amount == null ? undefined : formatCurrencyCents(invoice.amount, invoice.currency),
        });
      }
    }
    return next;
  }, [
    canApproveProcurement,
    canApproveTimesheets,
    canApproveExpenses,
    canApproveInvoices,
    procurements.data,
    timesheets.data,
    expenses.data,
    invoices.rows,
    selfId,
    realRole,
    t,
  ]);

  const isPending =
    (canApproveProcurement && procurements.isPending) ||
    (canApproveTimesheets && timesheets.isPending) ||
    (canApproveExpenses && expenses.isPending) ||
    (canApproveInvoices && invoices.isPending);
  const isError =
    (canApproveProcurement && procurements.isError) ||
    (canApproveTimesheets && timesheets.isError) ||
    (canApproveExpenses && expenses.isError) ||
    (canApproveInvoices && invoices.isError);

  return (
    <section aria-labelledby="my-queue-approvals" data-testid="my-queue-approvals">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id="my-queue-approvals" className="text-[15px] font-semibold">
          {t('queue.approvalsTitle', 'Awaiting your approval')}
        </h2>
        <div className="flex items-center gap-2">
          {!isPending && !isError && <Badge aria-label={t('queue.approvalsCount', '{{count}} waiting', { count: rows.length })}>{rows.length}</Badge>}
          <Link
            to="/approvals"
            className="touch-target rounded text-[13px] font-medium text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          >
            {t('queue.openApprovals', 'Open approvals')}
          </Link>
        </div>
      </div>
      {isPending && rows.length === 0 ? (
        <ListState variant="loading" rows={3} />
      ) : isError && rows.length === 0 ? (
        <ListState
          variant="error"
          title={t('queue.approvalsError.title', "Couldn't load your approvals")}
          sub={t('queue.approvalsError.sub', 'Open approvals to retry the queue.')}
        />
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-border bg-card px-4 py-3 text-[13px] text-muted-foreground" data-testid="my-queue-approvals-empty">
          {t('queue.approvalsEmpty', 'Nothing is waiting on your decision.')}
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {rows.map((row) => (
            <li key={row.key}>
              <Link
                to={row.to}
                className="flex min-h-11 items-start justify-between gap-3 px-4 py-3 hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              >
                <span className="min-w-0">
                  <span className="block break-words text-[13.5px] font-medium text-foreground">{row.title}</span>
                  <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">{row.context}</span>
                </span>
                {row.value && <span className="shrink-0 whitespace-nowrap text-[13px] tabular text-foreground">{row.value}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

const MyQueue: React.FC = () => {
  const { t } = useTranslation('home');
  const { t: tCommon } = useTranslation();
  const today = useOrgToday();
  const may = usePermission();
  const { realRole } = useEffectiveRole();
  const tasks = useMyTasks();

  const canApprove =
    may('transition', 'procurement') ||
    may('transition', 'approval') ||
    may('transition', 'salesInvoice') ||
    EXPENSE_APPROVER_ROLES.includes(realRole ?? '');

  // Open work only: a completed task is history, not queue.
  const openTasks = useMemo(() => {
    const rows = (tasks.data ?? []).filter((task) => task.status !== 'Done');
    const overdueFirst = (task: { end_date: string | null }) =>
      task.end_date && today && task.end_date < today ? 0 : 1;
    return [...rows].sort((a, b) => {
      const byUrgency = overdueFirst(a) - overdueFirst(b);
      if (byUrgency !== 0) return byUrgency;
      if (a.end_date === b.end_date) return 0;
      if (!a.end_date) return 1;
      if (!b.end_date) return -1;
      return a.end_date < b.end_date ? -1 : 1;
    });
  }, [tasks.data, today]);

  const visibleTasks = openTasks.slice(0, TASK_PREVIEW_LIMIT);
  const allSettledEmpty = !tasks.isPending && !tasks.isError && openTasks.length === 0;

  return (
    <div data-testid="my-queue-page">
      <div className="mb-4">
        <h1 className="text-[24px] font-bold tracking-[-0.02em]">{t('queue.title', 'My queue')}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {t('queue.subtitle', 'Your tasks and everything waiting on your decision.')}
        </p>
      </div>

      {canApprove && (
        <div className="mb-6">
          <MyApprovalsSection />
        </div>
      )}

      <section aria-labelledby="my-queue-tasks" data-testid="my-queue-tasks">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 id="my-queue-tasks" className="text-[15px] font-semibold">
            {t('queue.tasksTitle', 'Your tasks')}
          </h2>
          <div className="flex items-center gap-2">
            {!tasks.isPending && !tasks.isError && <Badge aria-label={t('queue.tasksCount', '{{count}} open tasks', { count: openTasks.length })}>{openTasks.length}</Badge>}
            <Link
              to="/my-tasks"
              className="touch-target rounded text-[13px] font-medium text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            >
              {t('queue.viewAllTasks', 'View all tasks')}
            </Link>
          </div>
        </div>

        {tasks.isPending ? (
          <ListState variant="loading" rows={3} />
        ) : tasks.isError ? (
          <ListState
            variant="error"
            title={t('queue.tasksError.title', "Couldn't load your tasks")}
            sub={t('queue.tasksError.sub', 'Retry to refresh your assigned work.')}
            onRetry={() => tasks.refetch()}
          />
        ) : openTasks.length === 0 ? (
          <p
            className="rounded-lg border border-border bg-card px-4 py-3 text-[13px] text-muted-foreground"
            data-testid="my-queue-tasks-empty"
            data-settled={allSettledEmpty ? 'true' : undefined}
          >
            {t('queue.tasksEmpty', 'No tasks are assigned to you right now.')}
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {visibleTasks.map((task) => {
              const overdue = Boolean(task.end_date && today && task.end_date < today);
              return (
                <li key={task.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <span className="min-w-0">
                    {task.project_id || task.meeting_id ? (
                      <Link
                        to={task.project_id ? `/projects/${task.project_id}/tasks#task-${task.id}` : `/meetings/${task.meeting_id}#task-${task.id}`}
                        className="block break-words text-[13.5px] font-medium text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        {task.name}
                      </Link>
                    ) : (
                      <span className="block break-words text-[13.5px] font-medium text-foreground">{task.name}</span>
                    )}
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
                      <span className="truncate">{task.project_name ?? t('queue.noProject', 'No project')}</span>
                      {task.end_date && (
                        <span>{t('queue.due', 'Due {{date}}', { date: formatDateOnly(task.end_date) })}</span>
                      )}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <StatusPill variant={task.status === 'Blocked' ? 'lost' : 'open'}>
                      {task.status === 'To Do'
                        ? tCommon('task.status.toDo', 'To Do')
                        : task.status === 'In Progress'
                          ? tCommon('task.status.inProgress', 'In Progress')
                          : tCommon('task.status.blocked', 'Blocked')}
                    </StatusPill>
                    {overdue && <StatusPill variant="warn">{t('queue.overdue', 'Overdue')}</StatusPill>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {openTasks.length > visibleTasks.length && (
          <Link
            to="/my-tasks"
            className="mt-2 block rounded px-1 py-2 text-[13px] font-medium text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          >
            {t('queue.moreTasks', 'Show all {{count}} open tasks', { count: openTasks.length })}
          </Link>
        )}
      </section>
    </div>
  );
};

export default MyQueue;
