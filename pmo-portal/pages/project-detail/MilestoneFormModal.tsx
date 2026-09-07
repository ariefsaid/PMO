import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  EntityFormModal,
  type SubmitError,
  TextField,
  FormSection,
  FormGrid,
  useEntityForm,
} from '@/src/components/ui';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { MilestoneWithProgress, MilestoneInput, MilestonePatch } from '@/src/lib/db/milestones';

// ── Form shape ─────────────────────────────────────────────────────────────────

interface FormValues {
  name: string;
  sort_order: string;
  target_date: string;
  weight: string;
  input_pct: string;
}

const validate = (
  v: FormValues,
  t: TFunction,
): Partial<Record<keyof FormValues, string>> => {
  const errors: Partial<Record<keyof FormValues, string>> = {};
  if (!v.name.trim()) {
    errors.name = t('projectDetail.milestoneForm.errors.nameRequired', 'Milestone name is required');
  }
  const w = v.weight.trim() !== '' ? Number(v.weight) : 1;
  if (isNaN(w) || w < 0) {
    errors.weight = t('projectDetail.milestoneForm.errors.weight', 'Weight must be 0 or greater');
  }
  if (v.input_pct.trim() !== '') {
    const p = Number(v.input_pct);
    if (isNaN(p) || p < 0 || p > 100) {
      errors.input_pct = t(
        'projectDetail.milestoneForm.errors.progressRange',
        'Progress must be between 0 and 100',
      );
    }
  }
  return errors;
};

// ── Props ─────────────────────────────────────────────────────────────────────

export interface MilestoneFormModalProps {
  milestone: MilestoneWithProgress | null;
  onClose: () => void;
  onCreate: (input: MilestoneInput) => Promise<void>;
  onUpdate: (id: string, patch: MilestonePatch) => Promise<void>;
  onError: (err: unknown) => void;
}

/**
 * Milestone create/edit form modal (Task 3.4, FR-DEL-008/009).
 * Uses the shared EntityFormModal + useEntityForm + TextField primitives.
 * Validates name (required), weight (≥0), input_pct (0–100 or blank) before
 * the DB round-trip so the user sees field errors immediately.
 */
const MilestoneFormModal: React.FC<MilestoneFormModalProps> = ({
  milestone,
  onClose,
  onCreate,
  onUpdate,
  onError,
}) => {
  const { t } = useTranslation();
  const isEdit = !!milestone;

  // Memoised on `t` so the validator keeps a stable identity between renders
  // (useEntityForm derives its live error map from it).
  const validateWithT = useCallback((v: FormValues) => validate(v, t), [t]);

  const form = useEntityForm<FormValues>({
    initialValues: {
      name: milestone?.name ?? '',
      sort_order: String(milestone?.sort_order ?? 0),
      target_date: milestone?.target_date ?? '',
      weight: String(milestone?.weight ?? 1),
      input_pct: milestone?.input_pct != null ? String(Math.round(milestone.input_pct)) : '',
    },
    validate: validateWithT,
    idPrefix: 'milestone-form',
    module: 'projects',
    requiredFields: ['name'],
  });

  const nameField = form.fieldProps('name');
  const sortField = form.fieldProps('sort_order');
  const dateField = form.fieldProps('target_date');
  const weightField = form.fieldProps('weight');
  const pctField = form.fieldProps('input_pct');

  const errorSummary = (() => {
    const items: { fieldId: string; message: string }[] = [];
    if (form.errors.name) items.push({ fieldId: nameField.id, message: form.errors.name });
    if (form.errors.weight) items.push({ fieldId: weightField.id, message: form.errors.weight });
    if (form.errors.input_pct) items.push({ fieldId: pctField.id, message: form.errors.input_pct });
    return items.length > 0 ? items : undefined;
  })();

  // #559 / AC-ERR-001: a rejected save must leave PERSISTENT evidence in the dialog. The toast
  // auto-dismisses after 4s, ~700px from where the user is looking, after which the modal is
  // indistinguishable from a pristine form with data in it — so the save looks like it worked.
  const [saveError, setSaveError] = useState<SubmitError | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (values) => {
      const name = values.name.trim();
      const sort_order = values.sort_order.trim() !== '' ? Number(values.sort_order) : 0;
      const target_date = values.target_date.trim() || null;
      const weight = values.weight.trim() !== '' ? Number(values.weight) : 1;
      const input_pct = values.input_pct.trim() !== '' ? Number(values.input_pct) : null;

      try {
        if (isEdit && milestone) {
          const patch: MilestonePatch = { name, sort_order, target_date, weight, input_pct };
          await onUpdate(milestone.id, patch);
        } else {
          const input: MilestoneInput = { name, sort_order, target_date, weight };
          await onCreate(input);
        }
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
      title={
        isEdit
          ? t('projectDetail.milestoneForm.editTitle', 'Edit milestone')
          : t('projectDetail.milestoneForm.newTitle', 'New milestone')
      }
      subtitle={
        isEdit
          ? t('projectDetail.milestoneForm.editSubtitle', 'Update this milestone')
          : t(
              'projectDetail.milestoneForm.newSubtitle',
              'Add a delivery milestone to this project',
            )
      }
      submitLabel={
        isEdit
          ? t('projectDetail.milestoneForm.save', 'Save milestone')
          : t('projectDetail.milestoneForm.create', 'Create milestone')
      }
      onSubmit={handleSubmit}
      submitError={saveError}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitDisabled={!form.isComplete}
      errorSummary={errorSummary}
    >
      <FormSection legend={t('projectDetail.milestoneForm.detailsLegend', 'Details')}>
        <FormGrid>
          <TextField
            id={nameField.id}
            label={t('projectDetail.milestoneForm.name', 'Milestone name')}
            required
            value={nameField.value}
            onChange={nameField.onChange}
            onBlur={nameField.onBlur}
            error={nameField.error}
            placeholder={t('projectDetail.milestoneForm.namePlaceholder', 'e.g. Engineering design')}
            fullWidth
          />
          <TextField
            id={dateField.id}
            label={t('projectDetail.milestoneForm.targetDate', 'Target date')}
            type="date"
            value={dateField.value}
            onChange={dateField.onChange}
            onBlur={dateField.onBlur}
          />
          <TextField
            id={sortField.id}
            label={t('projectDetail.milestoneForm.sortOrder', 'Sort order')}
            type="number"
            value={sortField.value}
            onChange={sortField.onChange}
            onBlur={sortField.onBlur}
            error={sortField.error}
          />
          <TextField
            id={weightField.id}
            label={t('projectDetail.milestoneForm.weight', 'Weight')}
            type="number"
            value={weightField.value}
            onChange={weightField.onChange}
            onBlur={weightField.onBlur}
            error={weightField.error}
          />
          {isEdit && (
            <TextField
              id={pctField.id}
              label={t('projectDetail.milestoneForm.inputPct', 'PM input % (optional)')}
              type="number"
              value={pctField.value}
              onChange={pctField.onChange}
              onBlur={pctField.onBlur}
              error={pctField.error}
              placeholder={t(
                'projectDetail.milestoneForm.inputPctPlaceholder',
                'Leave blank to use calculated',
              )}
            />
          )}
        </FormGrid>
      </FormSection>
    </EntityFormModal>
  );
};

export default MilestoneFormModal;
