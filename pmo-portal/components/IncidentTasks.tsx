import React, { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Combobox, EntityFormModal, FormGrid, StatusPill, TextField, useEntityForm, type ComboboxOption } from '@/src/components/ui';
import { DateField } from '@/src/components/ui/DateField';
import { formatDay } from '@/src/lib/format';
import type { IncidentTaskLine } from '@/src/lib/db/incidents';

interface FormValues {
  name: string;
  assignee_id: string | null;
  due_date: string;
}

/** Add one more task to an issue (#2677): a name, an optional person and an optional day. The database owns the permission rule. */
const AddTaskModal: React.FC<{
  assigneeOptions: ComboboxOption[];
  onSubmit: (input: { name: string; assigneeId: string | null; dueDate: string | null }) => Promise<void>;
  onClose: () => void;
}> = ({ assigneeOptions, onSubmit, onClose }) => {
  const { t } = useTranslation('incidents');
  const form = useEntityForm<FormValues>({
    initialValues: { name: '', assignee_id: null, due_date: '' },
    validate: (v) => (v.name.trim() ? {} : { name: t('tasks.nameRequired', 'Give the task a name.') }),
    idPrefix: 'incident-task-form',
    requiredFields: ['name'],
  });
  const nameField = form.fieldProps('name');
  const dueField = form.fieldProps('due_date');
  const loadAssignees = useCallback(async (): Promise<ComboboxOption[]> => assigneeOptions, [assigneeOptions]);

  return (
    <EntityFormModal
      open
      title={t('tasks.addTitle', 'Add a task')}
      submitLabel={t('tasks.add', 'Add a task')}
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit(async (values) => {
          await onSubmit({ name: values.name.trim(), assigneeId: values.assignee_id, dueDate: values.due_date || null });
        });
      }}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitDisabled={!form.isComplete}
      errorSummary={form.errors.name ? [{ fieldId: nameField.id, message: form.errors.name }] : undefined}
    >
      <FormGrid>
        <TextField
          id={nameField.id}
          label={t('tasks.name', 'Task')}
          required
          value={nameField.value}
          onChange={nameField.onChange}
          onBlur={nameField.onBlur}
          error={nameField.error}
          placeholder={t('tasks.namePlaceholder', 'e.g. Order the replacement part')}
          fullWidth
        />
        <Combobox
          label={t('form.assignee', 'Person in charge')}
          noun={t('form.assigneeNoun', 'person')}
          placeholder={t('form.assigneePlaceholder', 'Optional — who must fix it…')}
          value={form.values.assignee_id}
          selectedOption={assigneeOptions.find((o) => o.value === form.values.assignee_id) ?? null}
          onChange={(v) => form.setValue('assignee_id', v || null)}
          loadOptions={loadAssignees}
          clearable
          onClear={() => form.setValue('assignee_id', null)}
        />
        <DateField
          id={dueField.id}
          label={t('tasks.due', 'Due')}
          value={dueField.value}
          onChange={dueField.onChange}
          onBlur={dueField.onBlur}
          error={dueField.error}
        />
      </FormGrid>
    </EntityFormModal>
  );
};

/**
 * The tasks of an issue (#2677). Presentational: the page passes the embedded rows and the add handler.
 * A task row row security hides shows as a plain line. A legacy issue with one task renders one line.
 */
export const IncidentTasks: React.FC<{
  lines: IncidentTaskLine[];
  assigneeOptions: ComboboxOption[];
  canAdd: boolean;
  onAdd: (input: { name: string; assigneeId: string | null; dueDate: string | null }) => Promise<void>;
  onError: (err: unknown) => void;
}> = ({ lines, assigneeOptions, canAdd, onAdd, onError }) => {
  const { t } = useTranslation('incidents');
  const [open, setOpen] = useState(false);
  const names = useMemo(() => new Map(assigneeOptions.map((o) => [o.value, o.label])), [assigneeOptions]);

  return (
    <div data-testid="incident-tasks" className="flex flex-col gap-3">
      {lines.length === 0 ? (
        <p className="text-control text-muted-foreground">{t('tasks.none', 'No task yet.')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {lines.map((line, index) => {
            const task = line.tasks;
            if (!task) {
              return (
                <li key={`hidden-${index}`} className="py-2 text-control text-muted-foreground">
                  {t('tasks.hidden', 'A task you cannot view')}
                </li>
              );
            }
            return (
              <li key={task.id} data-testid="incident-task-row" className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <Link
                    className="text-control font-medium text-primary underline-offset-2 hover:underline"
                    to={`/projects/${task.project_id}/tasks?open=${encodeURIComponent(task.id)}`}
                  >
                    {task.name}
                  </Link>
                  <div className="text-control text-muted-foreground">
                    {[task.assignee_id ? names.get(task.assignee_id) ?? '…' : null, task.end_date ? t('tasks.dueOn', 'Due {{date}}', { date: formatDay(task.end_date) }) : null]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </div>
                </div>
                <StatusPill record="task" state={task.status} />
              </li>
            );
          })}
        </ul>
      )}
      {canAdd && (
        <div>
          <Button variant="outline" size="sm" data-testid="incident-add-task" onClick={() => setOpen(true)}>
            {t('tasks.add', 'Add a task')}
          </Button>
        </div>
      )}
      {open && (
        <AddTaskModal
          assigneeOptions={assigneeOptions}
          onClose={() => setOpen(false)}
          onSubmit={async (input) => {
            try {
              await onAdd(input);
              setOpen(false);
            } catch (err) {
              onError(err);
            }
          }}
        />
      )}
    </div>
  );
};
