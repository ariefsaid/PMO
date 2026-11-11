/**
 * Task status cell (XG03-005 / T-44) — the task list's one editable status affordance,
 * extracted beside the list columns it renders in. A static pill, or an inline select for
 * those who may set the status (managers: any; Engineer: own task only — the gating
 * decision arrives via the `editable` prop; TasksTab owns the permission and the write).
 * The ADR-0056 pending-push badge rides alongside when the write routes externally.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SelectField, StatusPill } from '@/src/components/ui';
import { TaskPushBadge } from '@/src/components/tasks/TaskPushBadge';
import type { PendingPushState } from '@/src/lib/adapterSeam/pendingPush';
import type { TaskWithRefs, TaskStatus } from '@/src/lib/db/tasks';
import { workflowVariant } from '@/src/lib/status/statusVariants';
import { STATUS_OPTIONS } from './taskViewModel';

interface TaskStatusCellProps {
  task: TaskWithRefs;
  editable: boolean;
  disabled: boolean;
  pendingPush: PendingPushState;
  onChange: (task: TaskWithRefs, status: TaskStatus) => void;
}

export const TaskStatusCell: React.FC<TaskStatusCellProps> = ({ task, editable, disabled, pendingPush, onChange }) => {
  const { t } = useTranslation('project');
  const [editing, setEditing] = useState(false);
  const selectContainerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const label = `${t('projectDetail.tasks.statusFor', 'Status for')} ${task.name}`;

  useEffect(() => {
    if (editing) selectContainerRef.current?.querySelector('select')?.focus();
  }, [editing]);

  const status = editable ? (
    editing ? (
      <div ref={selectContainerRef}>
        <SelectField
          hideLabel
          label={label}
          value={task.status}
          disabled={disabled}
          onChange={(value) => {
            setEditing(false);
            onChange(task, value as TaskStatus);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setEditing(false);
              buttonRef.current?.focus();
            }
          }}
          onBlur={() => setEditing(false)}
          options={STATUS_OPTIONS}
          className="w-auto min-w-[108px]"
        />
      </div>
    ) : (
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        disabled={disabled}
        onClick={() => setEditing(true)}
        className="touch-target inline-flex min-h-8 items-center rounded-sm text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <StatusPill variant={workflowVariant(task.status)}>{task.status}</StatusPill>
      </button>
    )
  ) : (
    <StatusPill variant={workflowVariant(task.status)}>{task.status}</StatusPill>
  );

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      {status}
      <TaskPushBadge state={pendingPush} />
    </div>
  );
};
