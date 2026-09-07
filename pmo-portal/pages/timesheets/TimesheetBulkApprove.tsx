/* Shared controller and controls intentionally live together so responsive queues cannot diverge. */
/* eslint-disable react-refresh/only-export-components */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button, Checkbox, ConfirmDialog, Icon, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useTimesheetMutations } from '@/src/hooks/useTimesheetApproval';
import { timesheetActions, type TimesheetAwaitingApproval } from '@/src/lib/db/timesheetTransition';
import { TimesheetStatus } from '../../types';
import { formatMonthDay } from '@/src/lib/format';

export type BulkController = ReturnType<typeof useTimesheetBulkApprove>;

/** The one week label for every approvals surface — translated, never duplicated per view. */
export function weekLabel(weekStart: string, t: TFunction): string {
  const [y, m, d] = weekStart.split('-').map(Number);
  return `${t('approvals.weekOf', 'Week of')} ${formatMonthDay(new Date(y, (m ?? 1) - 1, d ?? 1))}`;
}

export function useTimesheetBulkApprove(sheets: TimesheetAwaitingApproval[]) {
  const { t } = useTranslation();
  const { approve } = useTimesheetMutations();
  const { toast } = useToast();
  const isApprover = usePermission()('transition', 'approval');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [running, setRunning] = useState(false);

  const approvableIds = useMemo(
    () => new Set(sheets.filter((sheet) => timesheetActions(sheet.status as TimesheetStatus, false, isApprover).approve).map((sheet) => sheet.id)),
    [sheets, isApprover],
  );
  const effectiveSelected = useMemo(
    () => new Set([...selected].filter((id) => approvableIds.has(id))),
    [selected, approvableIds],
  );
  const allSelected = approvableIds.size > 0 && effectiveSelected.size === approvableIds.size;
  const someSelected = effectiveSelected.size > 0 && !allSelected;
  const exitSelection = () => {
    setSelecting(false);
    setSelected(new Set());
  };
  const toggleSelected = (id: string) => setSelected((previous) => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleSelectAll = () => setSelected(effectiveSelected.size > 0 ? new Set() : new Set(approvableIds));
  const commit = async () => {
    const ids = sheets.filter((sheet) => effectiveSelected.has(sheet.id)).map((sheet) => sheet.id);
    if (ids.length === 0) { setConfirmOpen(false); return; }
    setRunning(true);
    const results = await Promise.allSettled(ids.map((id) => approve.mutateAsync({ id })));
    const ok = results.filter((result) => result.status === 'fulfilled').length;
    const failed = results.length - ok;
    setRunning(false);
    setConfirmOpen(false);
    exitSelection();
    if (failed === 0) {
      toast(
        t('approvals.bulk.toast.allOk.headline', 'Timesheets approved'),
        t('approvals.bulk.toast.allOk.detail', '{{count}} approved', { count: ok }),
        'success',
      );
    } else if (ok === 0) {
      toast(
        t('approvals.bulk.toast.noneOk.headline', "Couldn't approve"),
        t('approvals.bulk.toast.noneOk.detail', '{{count}} failed (separation of duties or stale)', { count: failed }),
        'warning',
      );
    } else {
      toast(
        t('approvals.bulk.toast.partial.headline', 'Partially approved'),
        t('approvals.bulk.toast.partial.detail', '{{ok}} approved, {{failed}} failed (separation of duties or stale)', { ok, failed }),
        'warning',
      );
    }
  };
  return { selecting, setSelecting, selected, effectiveSelected, approvableIds, allSelected, someSelected, toggleSelected, toggleSelectAll, exitSelection, confirmOpen, setConfirmOpen, running, commit };
}

export function TimesheetBulkSelect({ controller }: { controller: BulkController }) {
  const { t } = useTranslation();
  if (!controller.approvableIds.size || controller.selecting) return null;
  return (
    <Button variant="outline" size="sm" onClick={() => controller.setSelecting(true)}>
      <Icon name="check" />
      {t('approvals.bulk.select', 'Select')}
    </Button>
  );
}

export function TimesheetBulkToolbar({ controller }: { controller: BulkController }) {
  const { t } = useTranslation();
  if (!controller.selecting) return null;
  const n = controller.effectiveSelected.size;
  return (
    <div role="group" aria-label={t('approvals.bulk.groupLabel', 'Bulk approve')} className="mb-3 flex flex-wrap items-center gap-2.5 rounded-lg bg-primary/[0.06] px-3 py-2.5">
      <Checkbox
        checked={controller.allSelected ? true : controller.someSelected ? 'mixed' : false}
        onChange={controller.toggleSelectAll}
        label={t('approvals.bulk.selectAll', 'Select all approvable weeks')}
      />
      <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-[12px] font-semibold tabular text-muted-foreground">
        {t('approvals.bulk.selectedCount', '{{count}} selected', { count: n })}
      </span>
      <span className="flex-1" />
      <Button variant="primary" size="sm" disabled={n === 0 || controller.running} loading={controller.running} onClick={() => controller.setConfirmOpen(true)}>
        <Icon name="check" />
        {t('approvals.bulk.approveN', 'Approve {{count}}', { count: n })}
      </Button>
      <Button variant="outline" size="sm" onClick={controller.exitSelection} disabled={controller.running}>
        {t('approvals.bulk.clear', 'Clear')}
      </Button>
    </div>
  );
}

export function TimesheetBulkConfirm({ controller, sheets }: { controller: BulkController; sheets: TimesheetAwaitingApproval[] }) {
  const { t } = useTranslation();
  if (!controller.confirmOpen) return null;
  const n = controller.effectiveSelected.size;
  const title = n === 1
    ? t('approvals.bulk.confirmTitleOne', 'Approve 1 timesheet?')
    : t('approvals.bulk.confirmTitleMany', 'Approve {{count}} timesheets?', { count: n });
  return (
    <ConfirmDialog
      open
      tone="default"
      title={title}
      description={(
        <span className="block">
          {t('approvals.bulk.confirmDescription', "This approves the selected weeks. You can't approve your own timesheet — separation of duties is enforced.")}
          <span className="mt-2 block space-y-0.5">
            {sheets.filter((sheet) => controller.effectiveSelected.has(sheet.id)).map((sheet) => (
              <span key={sheet.id} className="block text-[13px]">
                {sheet.owner?.full_name ?? t('approvals.unknownOwner', 'Unknown')} · {weekLabel(sheet.week_start_date, t)} · <span className="tabular">{sheet.entries.reduce((sum, entry) => sum + entry.hours, 0).toFixed(1)}</span> {t('approvals.bulk.hoursUnit', 'h')}
              </span>
            ))}
          </span>
        </span>
      )}
      confirmLabel={t('approvals.bulk.approveN', 'Approve {{count}}', { count: n })}
      loading={controller.running}
      onCancel={() => controller.setConfirmOpen(false)}
      onConfirm={controller.commit}
    />
  );
}

export function TimesheetBulkControls({ controller, sheets }: { controller: BulkController; sheets: TimesheetAwaitingApproval[] }) {
  return <><TimesheetBulkSelect controller={controller} /><TimesheetBulkToolbar controller={controller} /><TimesheetBulkConfirm controller={controller} sheets={sheets} /></>;
}
