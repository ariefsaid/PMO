import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Combobox,
  EntityFormModal,
  FormGrid,
  FormSection,
  TextField,
  useEntityForm,
  type ComboboxOption,
  type SubmitError,
} from '@/src/components/ui';
import { useAssignableProfiles } from '@/src/hooks/useTasks';
import { classifyMutationError, isMeetingReadDenied } from '@/src/lib/classifyMutationError';

interface ActionItemModalProps {
  /** The minute line's text — the PREFILL, fully editable (never silently published). */
  initialName: string;
  /** The meeting's project name, or null — the task's project is FIXED to it, shown not chosen. */
  projectName: string | null;
  onClose: () => void;
  onCreate: (input: { name: string; assigneeId: string; endDate: string }) => Promise<void>;
  onError: (err: unknown) => void;
}

/**
 * DD-MTG-8: `/action` is an informed authoring act. The minute line prefills the task name, the
 * author edits it freely, and only what they submit reaches `tasks.name`. Project is fixed to the
 * meeting's own project (the /action contract); meeting linkage is set on save.
 */
const ActionItemModal: React.FC<ActionItemModalProps> = ({
  initialName,
  projectName,
  onClose,
  onCreate,
  onError,
}) => {
  const { t } = useTranslation();
  const { data: profiles, isPending: profilesPending, isError: profilesError } = useAssignableProfiles();
  const form = useEntityForm<{ name: string; assigneeId: string; endDate: string }>({
    initialValues: { name: initialName, assigneeId: '', endDate: '' },
    validate: () => ({}),
    idPrefix: 'meeting-action-form',
    module: 'meetings',
  });
  const nameField = form.fieldProps('name');
  const assigneeField = form.fieldProps('assigneeId');
  const endDateField = form.fieldProps('endDate');
  const assigneeOptions: ComboboxOption[] = (profiles ?? []).map((profile) => ({
    value: profile.id,
    label: profile.full_name,
    sub: profile.role,
  }));
  const selectedAssignee = assigneeOptions.find((option) => option.value === assigneeField.value) ?? null;
  const [saveError, setSaveError] = useState<SubmitError | null>(null);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void form.handleSubmit(async (values) => {
      try {
        await onCreate(values);
      } catch (err) {
        if (isMeetingReadDenied(err)) {
          setSaveError({
            headline: t('meetingDetail.action.readDeniedHeadline', 'Action item not created'),
            detail: t('meetingDetail.action.readDeniedDetail', 'You can only create action items on meetings you can access.'),
          });
          onError(err);
          return;
        }
        const { headline, detail } = classifyMutationError(err, undefined, {
          module: 'meetings',
          operation: 'create',
          suppressCapture: true,
        });
        setSaveError({ headline, detail });
        onError(err);
      }
    });
  };

  return (
    <EntityFormModal
      open
      title={t('meetingDetail.action.modalTitle', 'New action item')}
      submitLabel={t('meetingDetail.action.modalSubmit', 'Create task')}
      onSubmit={handleSubmit}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitError={saveError}
    >
      <FormSection legend={t('meetingDetail.action.modalSection', 'Follow-up task')}>
        <FormGrid>
          <TextField
            id={nameField.id}
            label={t('meetingDetail.action.nameLabel', 'Task name')}
            value={nameField.value}
            onChange={nameField.onChange}
            onBlur={nameField.onBlur}
            placeholder={t('meetingDetail.action.placeholderName', 'Untitled action')}
            helper={t('meetingDetail.action.nameHelper', 'Visible to everyone who can see tasks. Prefilled from the minute line.')}
            fullWidth
          />
          {profilesError && (
            <p className="mt-1 text-control text-muted-foreground">
              {t('projectDetail.tasks.form.peopleLoadFailed', 'People could not be loaded; you can still save and assign later.')}
            </p>
          )}
          <Combobox
            label={t('meetingDetail.minutes.ownerLabel', 'Owner')}
            value={assigneeField.value || null}
            selectedOption={selectedAssignee}
            loadOptions={async () => assigneeOptions}
            onChange={(value) => assigneeField.onChange(value)}
            placeholder={profilesPending
              ? t('projectDetail.tasks.form.loadingPeople', 'Loading people…')
              : t('projectDetail.tasks.unassigned', 'Unassigned')}
            searchPlaceholder={t('projectDetail.tasks.form.searchPeople', 'Search people…')}
            noun={t('meetingDetail.action.personNoun', 'person')}
          />
          <TextField
            id={endDateField.id}
            label={t('meetingDetail.minutes.dueLabel', 'Due date')}
            type="date"
            value={endDateField.value}
            onChange={endDateField.onChange}
            onBlur={endDateField.onBlur}
          />
          <div className="text-sm">
            <div className="mb-1 font-medium text-muted-foreground">
              {t('meetingDetail.action.projectLabel', 'Project')}
            </div>
            <p data-testid="action-modal-project">
              {projectName ?? t('meetingDetail.action.projectNone', 'No project')}{' '}
              <span className="text-muted-foreground">
                {t('meetingDetail.action.projectFixed', '(fixed to this meeting’s project)')}
              </span>
            </p>
          </div>
        </FormGrid>
      </FormSection>
    </EntityFormModal>
  );
};

export default ActionItemModal;
