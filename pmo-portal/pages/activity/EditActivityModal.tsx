import React, { useState } from 'react';
import {
  EntityFormModal,
  TextField,
  TextArea,
  SelectField,
  FormSection,
  FormGrid,
  useEntityForm,
  type SubmitError,
} from '@/src/components/ui';
import { useTranslation } from 'react-i18next';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { CrmActivityKind, CrmActivityRow } from '@/src/lib/db/crmActivities';

/**
 * The ONE CRM activity edit modal (PGA02-006 / CROSS-69): the account timeline's former
 * AccountEditActivityModal and the contact timeline's former EditActivityModal, now a single
 * module with a narrow seam — activity, save, close, error, pending — and the context-specific
 * setting threaded through `module` (the useEntityForm analytics module stays companies on the
 * account page and contacts on the contact page). Both former modals carried the same fields,
 * trim-normalization and persistent submit-error handling; the label keys resolve identically
 * in every locale, so one canonical set cannot drift. The former account modal's unused
 * `contactOptions` prop is gone (OE01-002): the edit modal never offered changing the contact.
 */
interface ActivityFormValues {
  kind: CrmActivityKind;
  subject: string;
  body: string;
}

export interface EditActivityModalProps {
  activity: CrmActivityRow;
  onClose: () => void;
  onSave: (patch: { kind: CrmActivityKind; subject: string | null; body: string | null }) => Promise<void>;
  onError: (err: unknown) => void;
  isPending: boolean;
  /** Analytics/form module of the owning surface ('companies' | 'contacts'). */
  module?: 'companies' | 'contacts';
}

export const EditActivityModal: React.FC<EditActivityModalProps> = ({
  activity,
  onClose,
  onSave,
  onError,
  isPending,
  module = 'contacts',
}) => {
  const { t } = useTranslation();
  const form = useEntityForm<ActivityFormValues>({
    initialValues: {
      kind: activity.kind,
      subject: activity.subject ?? '',
      body: activity.body ?? '',
    },
    validate: () => ({}),
    idPrefix: 'edit-activity-form',
    requiredFields: [],
    module,
  });

  const kindField = form.fieldProps('kind');
  const subjectField = form.fieldProps('subject');
  const bodyField = form.fieldProps('body');

  // #559 / AC-ERR-001: a rejected save must leave PERSISTENT evidence in the dialog. The toast
  // auto-dismisses after 4s, ~700px from where the user is looking, after which the modal is
  // indistinguishable from a pristine form with data in it — so the save looks like it worked.
  const [saveError, setSaveError] = useState<SubmitError | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (values) => {
      try {
        await onSave({
          kind: values.kind,
          subject: values.subject.trim() || null,
          body: values.body.trim() || null,
        });
      } catch (err) {
        // `suppressCapture` only: the page's own `onError` classifies this same rejection for the
        // toast and owns the single `save_failed` event (ADR-0067).
        const { headline, detail } = classifyMutationError(err, undefined, { suppressCapture: true });
        setSaveError({ headline, detail });
        onError(err);
      }
    });
  };

  return (
    <EntityFormModal
      open
      title={t('contactDetail.editActivity.title', 'Edit activity')}
      subtitle={t('contactDetail.editActivity.subtitle', 'Update this activity log entry')}
      submitLabel={t('contactDetail.editActivity.submitLabel', 'Save')}
      onSubmit={handleSubmit}
      submitError={saveError}
      onClose={onClose}
      loading={isPending}
      dirty={form.isDirty}
    >
      <FormSection legend={t('contactDetail.editActivity.legend', 'Details')}>
        <FormGrid>
          <SelectField
            id={kindField.id}
            label={t('contactDetail.activity.type', 'Activity type')}
            value={kindField.value}
            onChange={(v) => kindField.onChange(v as CrmActivityKind)}
            options={[
              { value: 'Call', label: t('contactDetail.activityKind.call', 'Call') },
              { value: 'Email', label: t('contactDetail.activityKind.email', 'Email') },
              { value: 'Meeting', label: t('contactDetail.activityKind.meeting', 'Meeting') },
              { value: 'Note', label: t('contactDetail.activityKind.note', 'Note') },
            ]}
          />
          <TextField
            id={subjectField.id}
            label={t('contactDetail.activity.subject', 'Subject')}
            value={subjectField.value}
            onChange={subjectField.onChange}
            onBlur={subjectField.onBlur}
            placeholder={t('contactDetail.activity.subjectPlaceholder', 'e.g. Kickoff call')}
          />
        </FormGrid>
        <TextArea
          id={bodyField.id}
          label={t('contactDetail.activity.notes', 'Notes')}
          value={bodyField.value}
          onChange={bodyField.onChange}
          onBlur={bodyField.onBlur}
          rows={3}
          fullWidth
          placeholder={t('contactDetail.activity.notesPlaceholder', 'What was discussed?')}
        />
      </FormSection>
    </EntityFormModal>
  );
};
