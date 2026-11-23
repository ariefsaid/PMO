/** #2807: what a parent row shows in the Due and Status columns: the roll-up of its subtasks. */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip, ProgressBar } from '@/src/components/ui';
import { formatDay, formatDayRange } from '@/src/lib/format';
import type { TaskRollup } from '@/src/lib/tasks/taskTree';

/** A parent's dates: the span of its leaves. */
export function RollupDates({ rollup }: { rollup: TaskRollup }) {
  const { t } = useTranslation('project');
  if (!rollup.start && !rollup.end) return <span className="text-muted-foreground">—</span>;
  return <Tooltip content={t('projectDetail.tasks.tree.datesTip', 'From the earliest start to the latest due date of its subtasks.')}>
    <span tabIndex={0} className="block whitespace-normal break-words tabular text-muted-foreground">
      {rollup.start && rollup.end ? formatDayRange(rollup.start, rollup.end) : formatDay((rollup.start ?? rollup.end)!)}
    </span>
  </Tooltip>;
}

/** A parent's progress: done subtasks out of all, never its own status. */
export function RollupProgress({ rollup }: { rollup: TaskRollup }) {
  const { t } = useTranslation('project');
  return <Tooltip content={t('projectDetail.tasks.tree.progressTip', '{{done}} of {{total}} subtasks done. A task with subtasks takes its status from them.', { done: rollup.doneCount, total: rollup.leafCount })}>
    <span tabIndex={0} className="inline-flex min-w-0 items-center">
      <ProgressBar value={Math.round(rollup.pct)} tone={rollup.pct >= 100 ? 'success' : 'primary'} showValue compact aria-label={t('projectDetail.tasks.tree.progress', 'Subtask progress')} />
    </span>
  </Tooltip>;
}
