import React from 'react';
import {
  EntityFormModal,
  TextField,
  FormSection,
  FormGrid,
  useEntityForm,
} from '@/src/components/ui';
import type { MilestoneWithProgress, MilestoneInput, MilestonePatch } from '@/src/lib/db/milestones';

// ── Form shape ─────────────────────────────────────────────────────────────────

interface FormValues {
  name: string;
  sort_order: string;
  target_date: string;
  weight: string;
  input_pct: string;
}

const validate = (v: FormValues): Partial<Record<keyof FormValues, string>> => {
  const errors: Partial<Record<keyof FormValues, string>> = {};
  if (!v.name.trim()) {
    errors.name = 'Milestone name is required';
  }
  const w = v.weight.trim() !== '' ? Number(v.weight) : 1;
  if (isNaN(w) || w < 0) {
    errors.weight = 'Weight must be 0 or greater';
  }
  if (v.input_pct.trim() !== '') {
    const p = Number(v.input_pct);
    if (isNaN(p) || p < 0 || p > 100) {
      errors.input_pct = 'Progress must be between 0 and 100';
    }
  }
  return errors;
};

// ── Props ─────────────────────────────────────────────────────────────────────

export interface MilestoneFormModalProps {
  milestone: MilestoneWithProgress | null;
  projectId: string;
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
  const isEdit = !!milestone;

  const form = useEntityForm<FormValues>({
    initialValues: {
      name: milestone?.name ?? '',
      sort_order: String(milestone?.sort_order ?? 0),
      target_date: milestone?.target_date ?? '',
      weight: String(milestone?.weight ?? 1),
      input_pct: milestone?.input_pct != null ? String(Math.round(milestone.input_pct)) : '',
    },
    validate,
    idPrefix: 'milestone-form',
    requiredFields: ['name'],
  });

  const nameField = form.fieldProps('name');
  const sortField = form.fieldProps('sort_order');
  const dateField = form.fieldProps('target_date');
  const weightField = form.fieldProps('weight');
  const pctField = form.fieldProps('input_pct');

  const errorSummary = form.errors.name
    ? [{ fieldId: nameField.id, message: form.errors.name }]
    : undefined;

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
        onError(err);
      }
    });
  };

  return (
    <EntityFormModal
      open
      title={isEdit ? 'Edit milestone' : 'New milestone'}
      subtitle={isEdit ? 'Update this milestone' : 'Add a delivery milestone to this project'}
      submitLabel={isEdit ? 'Save milestone' : 'Create milestone'}
      onSubmit={handleSubmit}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitDisabled={!form.isComplete}
      errorSummary={errorSummary}
    >
      <FormSection legend="Details">
        <FormGrid>
          <TextField
            id={nameField.id}
            label="Milestone name"
            required
            value={nameField.value}
            onChange={nameField.onChange}
            onBlur={nameField.onBlur}
            error={nameField.error}
            placeholder="e.g. Engineering design"
            fullWidth
          />
          <TextField
            id={dateField.id}
            label="Target date"
            type="date"
            value={dateField.value}
            onChange={dateField.onChange}
            onBlur={dateField.onBlur}
          />
          <TextField
            id={sortField.id}
            label="Sort order"
            type="number"
            value={sortField.value}
            onChange={sortField.onChange}
            onBlur={sortField.onBlur}
            error={sortField.error}
          />
          <TextField
            id={weightField.id}
            label="Weight"
            type="number"
            value={weightField.value}
            onChange={weightField.onChange}
            onBlur={weightField.onBlur}
            error={weightField.error}
          />
          {isEdit && (
            <TextField
              id={pctField.id}
              label="PM input % (optional)"
              type="number"
              value={pctField.value}
              onChange={pctField.onChange}
              onBlur={pctField.onBlur}
              error={pctField.error}
              placeholder="Leave blank to use calculated"
            />
          )}
        </FormGrid>
      </FormSection>
    </EntityFormModal>
  );
};

export default MilestoneFormModal;
