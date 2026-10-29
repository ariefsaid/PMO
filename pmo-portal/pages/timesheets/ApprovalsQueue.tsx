import { projectDisplayName } from '@/src/lib/projectDisplayName';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  ApprovalRow,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  Icon,
  ListState,
  StatusPill,
  TimesheetGrid,
  useToast,
  type TimesheetDay,
  type TimesheetGridRow,
} from '@/src/components/ui';
import { TimesheetStatus } from '../../types';
import { usePermission } from '@/src/auth/usePermission';
import { useTimesheetsAwaitingApproval, useTimesheetMutations } from '@/src/hooks/useTimesheetApproval';
import { timesheetActions } from '@/src/lib/db/timesheetTransition';
import { TimesheetBulkControls, useTimesheetBulkApprove, weekLabel as bulkWeekLabel } from './TimesheetBulkApprove';
import type { TimesheetAwaitingApproval } from '@/src/lib/db/timesheetTransition';
import { workflowVariant } from '@/src/lib/status/statusVariants';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatNumberExact, formatWeekday } from '@/src/lib/format';

/** Sum a sheet's entry hours (entries are number-normalised at the DAL boundary). */
function sumHours(sheet: TimesheetAwaitingApproval): number {
  return sheet.entries.reduce((sum, e) => sum + e.hours, 0);
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function buildGrid(sheet: TimesheetAwaitingApproval, t: TFunction): { days: TimesheetDay[]; rows: TimesheetGridRow[] } {
  const [y, m, d] = sheet.week_start_date.split('-').map(Number);
  const weekStart = new Date(y, (m ?? 1) - 1, d ?? 1);
  const weekDates = Array.from({ length: 7 }).map((_, i) => {
    const dt = new Date(weekStart);
    dt.setDate(dt.getDate() + i);
    return dt;
  });
  const dateStrings = weekDates.map(isoDate);

  const days: TimesheetDay[] = weekDates.map((dt) => {
    const dow = dt.getDay();
    return {
      label: formatWeekday(dt),
      dateNum: String(dt.getDate()),
      weekend: dow === 0 || dow === 6,
    };
  });

  const map = new Map<string, TimesheetGridRow>();
  for (const e of sheet.entries) {
    const key = e.project_id;
    let row = map.get(key);
    if (!row) {
      row = {
        id: key,
        projectId: key,
        project: e.project ? projectDisplayName(e.project) : t('timesheets:approvalQueue.unknownProject', 'Unknown Project'),
        projectLegalName: e.project?.name,
        code: e.project?.code ?? null,
        hours: [0, 0, 0, 0, 0, 0, 0],
      };
      map.set(key, row);
    }
    const dayIdx = dateStrings.indexOf(e.entry_date);
    if (dayIdx >= 0) row.hours[dayIdx] += e.hours;
  }
  const rows = Array.from(map.values()).sort((a, b) => a.project.localeCompare(b.project));
  return { days, rows };
}

type PendingApproval = { kind: 'approve' | 'return'; id: string; name: string };

export interface TimesheetApprovalPreviewProps {
  sheet: TimesheetAwaitingApproval;
  surface?: 'panel' | 'inline';
  showSodNotice?: boolean;
}

export const TimesheetApprovalPreview: React.FC<TimesheetApprovalPreviewProps> = ({
  sheet,
  surface = 'panel',
  showSodNotice = surface === 'panel',
}) => {
  const { t } = useTranslation(['common', 'timesheets']);
  const { approve, reject } = useTimesheetMutations();
  const { toast } = useToast();
  const may = usePermission();
  const isApprover = may('transition', 'approval');
  const [pending, setPending] = useState<PendingApproval | null>(null);
  const actions = timesheetActions(sheet.status as TimesheetStatus, false, isApprover);
  const total = sumHours(sheet);
  const name = sheet.owner?.full_name ?? t('approvals.unknownOwner', 'Unknown');
  const { days, rows } = buildGrid(sheet, t);
  const isInline = surface === 'inline';

  const commitApproval = () => {
    if (!pending) return;
    const mutation = pending.kind === 'approve' ? approve : reject;
    const okHeadline = pending.kind === 'approve' ? t('timesheets:approvalQueue.approved', 'Timesheet approved') : t('timesheets:approvalQueue.returned', 'Timesheet returned');
    const okDetail =
      pending.kind === 'approve'
        ? t('timesheets:approvalQueue.approvedDetail', "{{name}}'s week approved", { name: pending.name })
        : t('timesheets:approvalQueue.returnedDetail', 'Sent back to {{name}} for changes', { name: pending.name });
    mutation.mutate(
      { id: pending.id },
      {
        onSuccess: () => {
          setPending(null);
          toast(okHeadline, okDetail, 'success');
        },
        onError: (err: unknown) => {
          setPending(null);
          const { headline, detail } = classifyMutationError(err);
          toast(headline, detail, 'warning');
        },
      },
    );
  };

  const actionCluster = !isInline && (actions.approve || actions.reject) ? (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {actions.approve && (
        <Button
          variant="primary"
          size="sm"
          onClick={() => setPending({ kind: 'approve', id: sheet.id, name })}
          loading={approve.isPending}
        >
          <Icon name="check" />
          {t('timesheets:approvalQueue.approve', 'Approve')}
        </Button>
      )}
      {actions.reject && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPending({ kind: 'return', id: sheet.id, name })}
          loading={reject.isPending}
        >
          {t('timesheets:approvalQueue.return', 'Return')}
        </Button>
      )}
    </div>
  ) : null;

  return (
    <>
      <div className={isInline ? 'space-y-2.5' : 'flex h-full flex-col'}>
        <div className={isInline ? undefined : 'border-b border-border pb-4'}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
                <span>{bulkWeekLabel(sheet.week_start_date, t)}</span>
                <span className="tabular font-medium text-foreground">{total.toFixed(1)} {t('approvals.bulk.hoursUnit', 'h')}</span>
                <StatusPill variant={workflowVariant(sheet.status)}>{sheet.status}</StatusPill>
              </div>
              <h2 className="text-lg font-semibold tracking-[-0.01em]">{name}</h2>
            </div>
            {actionCluster}
          </div>
          {!isInline && showSodNotice && (
            <p className="mt-3 text-[12px] text-muted-foreground">
              {t('approvals.timesheets.policyHelp', 'Policy: a different person approves each timesheet.')}
            </p>
          )}
        </div>

        <div className={isInline ? undefined : 'min-h-0 flex-1 overflow-y-auto pt-4'}>
          {rows.length === 0 ? (
            <p className="px-2 py-3 text-[13px] text-muted-foreground">{t('timesheets:approvalQueue.noHours', 'No hours recorded for this week.')}</p>
          ) : (
            <TimesheetGrid days={days} rows={rows} />
          )}
        </div>

        {isInline && (actions.approve || actions.reject) && (
          <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
            {actions.approve && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => setPending({ kind: 'approve', id: sheet.id, name })}
                loading={approve.isPending}
              >
                <Icon name="check" />
                {t('timesheets:approvalQueue.approve', 'Approve')}
              </Button>
            )}
            {actions.reject && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPending({ kind: 'return', id: sheet.id, name })}
                loading={reject.isPending}
              >
                {t('timesheets:approvalQueue.return', 'Return')}
              </Button>
            )}
          </div>
        )}
      </div>

      {pending && (
        <ConfirmDialog
          open
          tone={pending.kind === 'approve' ? 'default' : 'destructive'}
          title={
            pending.kind === 'approve'
              ? t('timesheets:approvalQueue.approveTitle', "Approve {{name}}'s week?", { name: pending.name })
              : t('timesheets:approvalQueue.returnTitle', "Return {{name}}'s timesheet?", { name: pending.name })
          }
          description={
            pending.kind === 'approve'
              ? t('timesheets:approvalQueue.approveDescription', "This approves {{name}}'s submitted week. You can't approve your own timesheet — separation of duties is enforced.", { name: pending.name })
              : t('timesheets:approvalQueue.returnDescription', "This sends {{name}}'s week back for changes. They'll need to correct and resubmit it.", { name: pending.name })
          }
          confirmLabel={pending.kind === 'approve' ? t('timesheets:approvalQueue.approve', 'Approve') : t('timesheets:approvalQueue.returnConfirm', 'Return timesheet')}
          loading={pending.kind === 'approve' ? approve.isPending : reject.isPending}
          onCancel={() => setPending(null)}
          onConfirm={commitApproval}
        />
      )}
    </>
  );
};

/**
 * The manager/admin approval queue — the Timesheets "Approvals queue" toggle body,
 * and the timesheet section of the `/approvals` inbox.
 */
export const ApprovalsQueue: React.FC = () => {
  const { t } = useTranslation(['common', 'timesheets']);
  const { data: queue, isPending, isError, refetch } = useTimesheetsAwaitingApproval();
  const { approve, reject } = useTimesheetMutations();
  const { toast } = useToast();
  const may = usePermission();
  const isApprover = may('transition', 'approval');
  const [pending, setPending] = useState<PendingApproval | null>(null);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const sheets = useMemo(() => queue ?? [], [queue]);
  const bulk = useTimesheetBulkApprove(sheets);
  const { selecting, selected, approvableIds } = bulk;

  const commitApproval = () => {
    if (!pending) return;
    const mutation = pending.kind === 'approve' ? approve : reject;
    const okHeadline = pending.kind === 'approve' ? t('timesheets:approvalQueue.approved', 'Timesheet approved') : t('timesheets:approvalQueue.returned', 'Timesheet returned');
    const okDetail =
      pending.kind === 'approve'
        ? t('timesheets:approvalQueue.approvedDetail', "{{name}}'s week approved", { name: pending.name })
        : t('timesheets:approvalQueue.returnedDetail', 'Sent back to {{name}} for changes', { name: pending.name });
    mutation.mutate(
      { id: pending.id },
      {
        onSuccess: () => {
          setPending(null);
          toast(okHeadline, okDetail, 'success');
        },
        onError: (err: unknown) => {
          setPending(null);
          const { headline, detail } = classifyMutationError(err);
          toast(headline, detail, 'warning');
        },
      },
    );
  };


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
        title={t('timesheets:approvalQueue.loadError', "Couldn't load the approval queue")}
        sub={t('timesheets:approvalQueue.loadErrorSub', 'Something went wrong fetching timesheets awaiting your approval.')}
        onRetry={() => refetch()}
      />
    );
  }

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <h2 className="text-sm font-semibold">{t('timesheets:approvalQueue.heading', 'Team approvals queue')}</h2>
        <span className="flex-1" />
        {sheets.length > 0 && (
          <StatusPill variant="overdue" aria-label={t('timesheets:approvalQueue.awaiting', '{{total}} awaiting you', { total: formatNumberExact(sheets.length) })}>
            {t('timesheets:approvalQueue.awaiting', '{{total}} awaiting you', { total: formatNumberExact(sheets.length) })}
          </StatusPill>
        )}
        <TimesheetBulkControls controller={bulk} sheets={sheets} />
      </div>

      <p className="mb-3 text-[12px] text-muted-foreground">
        {t('approvals.timesheets.policyHelp', 'Policy: a different person approves each timesheet.')}
      </p>



      {sheets.length === 0 ? (
        <div data-testid="approvals-empty">
          <ListState
            variant="empty"
            icon="check"
            title={t('timesheets:approvalQueue.empty', 'Nothing awaiting you')}
            sub={t('timesheets:approvalQueue.emptySub', 'Submitted timesheets from your reports will appear here for review.')}
          />
        </div>
      ) : (
        <div>
          {sheets.map((sheet) => {
            const total = sumHours(sheet);
            const actions = timesheetActions(sheet.status as TimesheetStatus, false, isApprover);
            const name = sheet.owner?.full_name ?? t('approvals.unknownOwner', 'Unknown');
            const isExpanded = expanded.has(sheet.id);
            const panelId = `ts-breakdown-${sheet.id}`;
            const canSelect = approvableIds.has(sheet.id);
            return (
              <div key={sheet.id} data-week-start={sheet.week_start_date}>
                <ApprovalRow
                  name={name}
                  subtitle={<span>{bulkWeekLabel(sheet.week_start_date, t)} · <span className="tabular">{total.toFixed(1)}</span> {t('approvals.bulk.hoursUnit', 'h')}</span>}
                  onActivate={() => toggleExpanded(sheet.id)}
                  status={<StatusPill variant={workflowVariant(sheet.status)}>{sheet.status}</StatusPill>}
                  disclosure={
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-expanded={isExpanded}
                      aria-controls={panelId}
                      aria-label={t('timesheets:approvalQueue.showHours', 'Show hours for {{name}}', { name })}
                      onClick={() => toggleExpanded(sheet.id)}
                      className={
                        isExpanded
                          ? '[&_svg]:rotate-90 [&_svg]:transition-transform'
                          : '[&_svg]:transition-transform'
                      }
                    >
                      <Icon name="chev" />
                    </Button>
                  }
                >
                  {selecting && canSelect && (
                    <Checkbox
                      checked={selected.has(sheet.id)}
                      onChange={() => bulk.toggleSelected(sheet.id)}
                      label={t('approvals.bulk.rowSelect', "Select {{owner}}'s {{week}}", { owner: name, week: bulkWeekLabel(sheet.week_start_date, t) })}
                    />
                  )}
                  {actions.approve && !selecting && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => setPending({ kind: 'approve', id: sheet.id, name })}
                      loading={approve.isPending}
                    >
                      <Icon name="check" />
                      {t('timesheets:approvalQueue.approve', 'Approve')}
                    </Button>
                  )}
                  {actions.reject && !selecting && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPending({ kind: 'return', id: sheet.id, name })}
                      loading={reject.isPending}
                    >
                      {t('timesheets:approvalQueue.return', 'Return')}
                    </Button>
                  )}
                </ApprovalRow>

                {isExpanded && (
                  <div id={panelId} className="mb-2 rounded-lg border border-border bg-secondary/20 p-2">
                    <TimesheetApprovalPreview sheet={sheet} surface="inline" showSodNotice={false} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {pending && (
        <ConfirmDialog
          open
          tone={pending.kind === 'approve' ? 'default' : 'destructive'}
          title={
            pending.kind === 'approve'
              ? t('timesheets:approvalQueue.approveTitle', "Approve {{name}}'s week?", { name: pending.name })
              : t('timesheets:approvalQueue.returnTitle', "Return {{name}}'s timesheet?", { name: pending.name })
          }
          description={
            pending.kind === 'approve'
              ? t('timesheets:approvalQueue.approveDescription', "This approves {{name}}'s submitted week. You can't approve your own timesheet — separation of duties is enforced.", { name: pending.name })
              : t('timesheets:approvalQueue.returnDescription', "This sends {{name}}'s week back for changes. They'll need to correct and resubmit it.", { name: pending.name })
          }
          confirmLabel={pending.kind === 'approve' ? t('timesheets:approvalQueue.approve', 'Approve') : t('timesheets:approvalQueue.returnConfirm', 'Return timesheet')}
          loading={pending.kind === 'approve' ? approve.isPending : reject.isPending}
          onCancel={() => setPending(null)}
          onConfirm={commitApproval}
        />
      )}


    </Card>
  );
};
