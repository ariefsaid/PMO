import React from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Checkbox, ListState } from '@/src/components/ui';
import { formatTableMoney } from '@/src/lib/format';
import { ageInDays, urgencyOf } from '@/src/lib/selectors/approvalUrgency';
import { weekLabel, type BulkController } from '../timesheets/TimesheetBulkApprove';
import type { ProcurementBulkController } from './useProcurementBulkApprove';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import type { TimesheetAwaitingApproval } from '@/src/lib/db/timesheetTransition';

/** The queue's discriminated row: which pane renders, and what the preview needs. */
export type QueueItem =
  | { key: string; kind: 'procurement'; row: ProcurementWithRefs }
  | { key: string; kind: 'timesheets'; row: TimesheetAwaitingApproval };

function sumHours(sheet: TimesheetAwaitingApproval): number {
  return sheet.entries.reduce((sum, e) => sum + e.hours, 0);
}

export function QueueButton({
  item,
  selected,
  onSelect,
  bulk,
  procurementBulk,
}: {
  item: QueueItem;
  selected: boolean;
  onSelect: () => void;
  bulk?: BulkController;
  procurementBulk?: ProcurementBulkController;
}) {
  const { t } = useTranslation();
  if (item.kind === 'procurement') {
    const row = item.row;
    const canSelect = procurementBulk?.approvableIds.has(row.id) ?? false;
    const waitingDays = ageInDays(row.created_at);
    const overdue = urgencyOf(row.created_at) === 'overdue';
    const rowButton = (
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={[
          'w-full rounded-lg border px-3 py-3 text-left transition-colors',
          selected ? 'border-foreground/20 bg-secondary/70' : 'border-transparent hover:border-border hover:bg-secondary/40',
        ].join(' ')}
      >
        <div className="min-w-0">
          <div className="line-clamp-2 break-words text-sm font-medium" title={row.title}>{row.title}</div>
          {/* Every row here is awaiting a decision, so no status pill repeats it; only the wait is shown. */}
          {waitingDays > 0 && <div className="mt-1"><span className={overdue ? 'text-control font-medium text-destructive-text' : 'text-control text-muted-foreground'}>{t('procurement:approvalQueue.waitingDays', { count: waitingDays, defaultValue_one: '{{count}} day waiting', defaultValue_other: '{{count}} days waiting' })}</span></div>}
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-control text-muted-foreground">
            <span>{row.requested_by?.full_name ?? t('approvals.unknownRequester', 'Unknown requester')}</span>
            <span>·</span>
            <span className="font-mono">{row.code ?? row.id.slice(0, 8)}</span>
          </div>
        </div>
        <div className="mt-2 text-control text-muted-foreground">
          <span className="block break-words">{row.project?.name ?? t('approvals.noProjectLinked', 'No project linked')}</span>
          <span className="mt-1 block tabular font-medium text-foreground">{formatTableMoney(row.total_value, row.currency) ?? '—'}</span>
        </div>
      </button>
    );
    return procurementBulk?.selecting && canSelect ? (
      <div className="flex items-center gap-2">
        <Checkbox
          checked={procurementBulk.selected.has(row.id)}
          onChange={() => procurementBulk.toggleSelected(row.id)}
          label={t('procurement:procurementBulk.rowSelect', 'Select {{title}}', { title: row.title })}
          disabled={procurementBulk.running}
        />
        {rowButton}
      </div>
    ) : rowButton;
  }

  const row = item.row;
  const canSelect = bulk?.approvableIds.has(row.id) ?? false;
  const rowButton = (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={[
        'min-w-0 flex-1 rounded-lg border px-3 py-3 text-left transition-colors',
        selected ? 'border-foreground/20 bg-secondary/70' : 'border-transparent hover:border-border hover:bg-secondary/40',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">
            {row.owner?.full_name ?? t('approvals.unknownOwner', 'Unknown')}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-control text-muted-foreground">
            <span>{weekLabel(row.week_start_date, t)}</span>
            <span>·</span>
            <span>{row.entries[0]?.project?.name ?? t('approvals.noProjectLinked', 'No project linked')}</span>
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-control text-muted-foreground">
        <span>
          {row.entries.length}{' '}
          {row.entries.length === 1
            ? t('approvals.entryOne', 'entry')
            : t('approvals.entryOther', 'entries')}
        </span>
        <span className="tabular font-medium text-foreground">{sumHours(row).toFixed(1)} h</span>
      </div>
    </button>
  );
  return bulk?.selecting && canSelect ? (
    <div className="flex items-center gap-2">
      <Checkbox checked={bulk.selected.has(row.id)} onChange={() => bulk.toggleSelected(row.id)} label={t('approvals.bulk.rowSelect', "Select {{owner}}'s {{week}}", { owner: row.owner?.full_name ?? t('approvals.unknownOwner', 'Unknown'), week: weekLabel(row.week_start_date, t) })} />
      {rowButton}
    </div>
  ) : rowButton;
}

export function QueueGroup({
  title,
  count,
  items,
  selectedKey,
  onSelect,
  isPending,
  isError,
  onRetry,
  emptyTitle,
  bulk,
  procurementBulk,
  hideWhenEmpty = false,
}: {
  title: string;
  count: number;
  items: QueueItem[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  emptyTitle: string;
  bulk?: BulkController;
  procurementBulk?: ProcurementBulkController;
  /** Another group already has rows: an empty group is left out instead of drawing its own box. */
  hideWhenEmpty?: boolean;
}) {
  const { t } = useTranslation();
  if (hideWhenEmpty && !isPending && !isError && items.length === 0) return null;
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-control font-semibold text-muted-foreground">
          {title}
        </h2>
        <Badge>{count}</Badge>
      </div>

      {isPending ? (
        <ListState variant="loading" rows={2} className="rounded-lg border border-border/70 p-0" />
      ) : isError ? (
        <ListState
          variant="error"
          title={t('approvals.queue.loadError', "Couldn't load {{queue}}", {
            queue: title.toLowerCase(),
          })}
          sub={t('approvals.queue.loadErrorSub', 'Try again to refresh this queue.')}
          onRetry={onRetry}
        />
      ) : items.length === 0 ? (
        <p className="py-2 text-control text-muted-foreground">{emptyTitle}</p>
      ) : (
        <div className="space-y-1.5">
          {items.map((item) => (
            <QueueButton
              key={item.key}
              item={item}
              selected={selectedKey === item.key}
              onSelect={() => onSelect(item.key)}
              bulk={bulk}
              procurementBulk={procurementBulk}
            />
          ))}
        </div>
      )}
    </section>
  );
}
