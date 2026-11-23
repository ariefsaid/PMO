/**
 * #2807: the Subtasks section of the task form. A person adds subtask rows in place (name, and optionally an
 * assignee and a due date); any row takes its own subtasks, to any depth. The rows are saved with the task in one
 * request (createTaskTree), so a tree is never half saved on a project the PMO owns.
 */
import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Icon, SelectField, TextField } from '@/src/components/ui';
import { DateField } from '@/src/components/ui/DateField';
import type { SubtaskDraft } from '@/src/lib/db/tasks';
import { newDraft } from './subtaskDraftModel';

const update = (drafts: SubtaskDraft[], key: string, fn: (d: SubtaskDraft) => SubtaskDraft | null): SubtaskDraft[] =>
  drafts.flatMap((d) => {
    if (d.key === key) { const next = fn(d); return next ? [next] : []; }
    return [{ ...d, children: update(d.children, key, fn) }];
  });

const INDENT_PX = 16;

export function SubtaskDraftsEditor({ drafts, onChange, people, existing, autoFocusFirst }: {
  drafts: SubtaskDraft[];
  onChange: (next: SubtaskDraft[]) => void;
  people: { value: string; label: string }[];
  /** Names of the task's subtasks that already exist (edit), listed above the new rows. */
  existing: string[];
  autoFocusFirst?: boolean;
}) {
  const { t } = useTranslation('project');
  const lastAdded = useRef<string | null>(autoFocusFirst ? drafts[0]?.key ?? null : null);
  useEffect(() => {
    if (!lastAdded.current) return;
    document.getElementById(`subtask-${lastAdded.current}`)?.focus();
    lastAdded.current = null;
  });
  const add = (parentKey: string | null) => {
    const d = newDraft();
    lastAdded.current = d.key;
    onChange(parentKey ? update(drafts, parentKey, (p) => ({ ...p, children: [...p.children, d] })) : [...drafts, d]);
  };
  const row = (d: SubtaskDraft, depth: number): React.ReactNode => (
    <li key={d.key}>
      <div
        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-border/60 py-2"
        style={depth > 0 ? { paddingLeft: depth * INDENT_PX } : undefined}
      >
        <TextField
          id={`subtask-${d.key}`}
          label={t('projectDetail.tasks.subtasks.name', 'Subtask name')}
          hideLabel
          value={d.name}
          onChange={(name) => onChange(update(drafts, d.key, (x) => ({ ...x, name })))}
          placeholder={t('projectDetail.tasks.subtasks.namePlaceholder', 'Subtask name')}
          maxLength={500}
          wrapperClassName="min-w-0"
        />
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            iconOnly
            onClick={() => add(d.key)}
            aria-label={t('projectDetail.tasks.subtasks.addUnder', 'Add a subtask under {{name}}', { name: d.name || t('projectDetail.tasks.subtasks.thisRow', 'this row') })}
          >
            <Icon name="plus" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            iconOnly
            onClick={() => onChange(update(drafts, d.key, () => null))}
            aria-label={t('projectDetail.tasks.subtasks.remove', 'Remove {{name}}', { name: d.name || t('projectDetail.tasks.subtasks.thisRow', 'this row') })}
          >
            <Icon name="x" />
          </Button>
        </div>
        <div className="col-span-2 grid grid-cols-2 gap-2">
          <SelectField
            label={t('projectDetail.tasks.form.assignee', 'Assignee')}
            hideLabel
            value={d.assigneeId}
            onChange={(assigneeId) => onChange(update(drafts, d.key, (x) => ({ ...x, assigneeId })))}
            options={people}
            placeholder={t('projectDetail.tasks.unassigned', 'Unassigned')}
          />
          <DateField
            label={t('projectDetail.tasks.form.dueDate', 'Due date')}
            hideLabel
            value={d.due}
            onChange={(due) => onChange(update(drafts, d.key, (x) => ({ ...x, due })))}
          />
        </div>
      </div>
      {d.children.length > 0 && <ul>{d.children.map((c) => row(c, depth + 1))}</ul>}
    </li>
  );
  return (
    <div>
      {existing.length > 0 && (
        <ul className="mb-1">
          {existing.map((name, i) => (
            <li key={`${name}-${i}`} className="flex items-center gap-2 border-b border-border/60 py-2 text-sm text-foreground">
              {name}
            </li>
          ))}
        </ul>
      )}
      {drafts.length > 0 && <ul>{drafts.map((d) => row(d, 0))}</ul>}
      <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => add(null)}>
        <Icon name="plus" />{t('projectDetail.tasks.subtasks.add', 'Add subtask')}
      </Button>
    </div>
  );
}
