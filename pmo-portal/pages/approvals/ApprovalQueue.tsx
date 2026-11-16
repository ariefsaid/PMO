import React from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Checkbox, ListState } from '@/src/components/ui';
import { formatNumberExact, formatTableMoney } from '@/src/lib/format';
import { ageInDays, groupByArrival, timesheetWaitingSince, urgencyOf, type ArrivalGroup } from '@/src/lib/selectors/approvalUrgency';
import { weekLabel, type BulkController } from '../timesheets/TimesheetBulkApprove';
import type { ProcurementBulkController } from './useProcurementBulkApprove';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import type { TimesheetAwaitingApproval } from '@/src/lib/db/timesheetTransition';

/** The queue's discriminated row: which pane renders, and what the preview needs. */
export type QueueItem =
  | { key: string; kind: 'procurement'; row: ProcurementWithRefs }
  | { key: string; kind: 'timesheets'; row: TimesheetAwaitingApproval };

/** How long a queue item has waited: a purchase from when it was raised, a week from its submission. */
function queueWaitingSince(item: QueueItem): string | null | undefined {
  return item.kind === 'procurement' ? item.row.created_at : timesheetWaitingSince(item.row);
}

function sumHours(sheet: TimesheetAwaitingApproval): number {
  return sheet.entries.reduce((sum, e) => sum + e.hours, 0);
}

/** Waiting time on line two: muted while fresh, the waiting tone once it is overdue (the same rule as the Overdue group). */
export function WaitingFor({ iso }: { iso: string | null | undefined }) {
  const { t } = useTranslation();
  const days = ageInDays(iso);
  const old = urgencyOf(iso) === 'overdue';
  return (
    <span data-old={old || undefined} className={old ? 'shrink-0 font-medium text-warning-foreground' : 'shrink-0'}>
      {days > 0
        ? t('procurement:approvalQueue.waitingDays', { count: days, defaultValue_one: '{{count}} day waiting', defaultValue_other: '{{count}} days waiting' })
        : t('procurement:approvalQueue.waitingToday', 'Today')}
    </span>
  );
}

/** Two lines, read in one glance: what + how much, then who raised it · how long it waited · project. */
function RowFace({ what, amount, who, waitingSince, project }: {
  what: React.ReactNode;
  amount: React.ReactNode;
  who: React.ReactNode;
  waitingSince: string | null | undefined;
  project: React.ReactNode;
}) {
  return (
    <span className="block min-w-0">
      <span className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-medium text-foreground">{what}</span>
        <span className="shrink-0 whitespace-nowrap tabular text-sm font-semibold text-foreground">{amount}</span>
      </span>
      <span className="mt-1 flex min-w-0 items-baseline gap-x-1.5 text-control text-muted-foreground">
        <span className="shrink-0">{who}</span>
        <span aria-hidden>·</span>
        <WaitingFor iso={waitingSince} />
        <span aria-hidden>·</span>
        <span className="min-w-0 truncate">{project}</span>
      </span>
    </span>
  );
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
  // Each row is one record (`data-record-row`): its text is data, not page copy, however the age groups split the list.
  const rowClass = [
    'min-w-0 flex-1 rounded-lg border px-3 py-2.5 text-left transition-colors max-lg:min-h-11',
    selected ? 'border-foreground/20 bg-secondary/70' : 'border-transparent hover:border-border hover:bg-secondary/40',
  ].join(' ');
  if (item.kind === 'procurement') {
    const row = item.row;
    const canSelect = procurementBulk?.approvableIds.has(row.id) ?? false;
    const rowButton = (
      <button type="button" onClick={onSelect} aria-pressed={selected} data-queue-key={item.key} data-record-row className={`w-full ${rowClass}`}>
        <RowFace
          // dev showed the record number on the row; it leads line one, regular and muted, so truncation takes the title first
          what={<span title={row.title}><span className="font-normal text-muted-foreground">{row.code ?? row.id.slice(0, 8)}</span> {row.title}</span>}
          amount={formatTableMoney(row.total_value, row.currency) ?? '—'}
          who={row.requested_by?.full_name ?? t('approvals.unknownRequester', 'Unknown requester')}
          waitingSince={row.created_at}
          project={row.project?.name ?? t('approvals.noProjectLinked', 'No project linked')}
        />
      </button>
    );
    return procurementBulk?.selecting && canSelect ? (
      <div data-record-row className="flex items-center gap-2">
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
  const owner = row.owner?.full_name ?? t('approvals.unknownOwner', 'Unknown');
  const rowButton = (
    <button type="button" onClick={onSelect} aria-pressed={selected} data-queue-key={item.key} data-record-row className={`w-full ${rowClass}`}>
      <RowFace
        what={weekLabel(row.week_start_date, t)}
        amount={`${formatNumberExact(sumHours(row))} ${t('approvals.bulk.hoursUnit', 'h')}`}
        who={owner}
        waitingSince={timesheetWaitingSince(row)}
        project={row.entries[0]?.project?.name ?? t('approvals.noProjectLinked', 'No project linked')}
      />
    </button>
  );
  return bulk?.selecting && canSelect ? (
    <div data-record-row className="flex items-center gap-2">
      <Checkbox checked={bulk.selected.has(row.id)} onChange={() => bulk.toggleSelected(row.id)} label={t('approvals.bulk.rowSelect', "Select {{owner}}'s {{week}}", { owner, week: weekLabel(row.week_start_date, t) })} />
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
  toolbar,
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
  /** This group's bulk bar while selecting: it sits with the rows it acts on. */
  toolbar?: React.ReactNode;
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
      {toolbar}

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

/**
 * The loaded queue by how long each item has waited: Overdue, Today, Earlier, oldest first inside each. Purchases and
 * weeks mix inside a group, so the oldest decision is always on top; the age rides on every row.
 */
export function UrgencyQueue({
  items,
  selectedKey,
  onSelect,
  bulk,
  procurementBulk,
  now,
}: {
  items: QueueItem[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  bulk?: BulkController;
  procurementBulk?: ProcurementBulkController;
  /** Test seam: the moment ages are measured from. */
  now?: Date;
}) {
  const { t } = useTranslation();
  const groups = groupByArrival(items, queueWaitingSince, now);
  const labels: Record<ArrivalGroup, string> = {
    overdue: t('procurement:approvalQueue.group.overdue', 'Overdue'),
    today: t('procurement:approvalQueue.group.today', 'Today'),
    earlier: t('procurement:approvalQueue.group.earlier', 'Earlier'),
  };
  return (
    <>
      {groups.map(({ group, items: groupItems }) => (
        <section key={group} aria-labelledby={`approvals-urgency-${group}`} data-urgency={group}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 id={`approvals-urgency-${group}`} className="text-control font-semibold text-muted-foreground">
              {labels[group]}
            </h3>
            <Badge>{groupItems.length}</Badge>
          </div>
          <div className="space-y-1.5">
            {groupItems.map((item) => (
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
        </section>
      ))}
    </>
  );
}
