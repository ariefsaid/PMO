import React from 'react';
import {
  EntityFormModal,
  TextField,
  TextArea,
  SelectField,
  FormSection,
  FormGrid,
  useEntityForm,
} from '@/src/components/ui';
import type { IncidentRow, IncidentSeverity, IncidentInput } from '@/src/lib/db/incidents';

/** Severity options for the file/edit form (the `incident_severity` enum). */
const SEVERITY_OPTIONS = [
  { value: 'Low', label: 'Low' },
  { value: 'Medium', label: 'Medium' },
  { value: 'High', label: 'High' },
  { value: 'Critical', label: 'Critical' },
];

interface FormValues {
  incident_date: string;
  type: string;
  severity: IncidentSeverity;
  location: string;
  description: string;
}

const validate = (v: FormValues): Partial<Record<keyof FormValues, string>> => {
  const errors: Partial<Record<keyof FormValues, string>> = {};
  if (!v.incident_date.trim()) errors.incident_date = 'Incident date is required.';
  if (!v.type.trim()) errors.type = 'Incident type is required.';
  return errors;
};

/**
 * Today as a LOCAL-date `YYYY-MM-DD` string (the <input type="date"> value format,
 * matching the `date` — not timestamptz — column). Built from local
 * getFullYear/getMonth/getDate to avoid the UTC-midnight off-by-one that
 * `toISOString().slice(0,10)` would introduce in negative-UTC-offset zones.
 */
function todayLocalISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export interface IncidentFormModalProps {
  /** null = file (create); a row = edit. */
  incident: IncidentRow | null;
  onClose: () => void;
  onCreate: (input: IncidentInput) => Promise<void>;
  onUpdate: (id: string, input: IncidentInput) => Promise<void>;
  onError: (err: unknown) => void;
}

/**
 * The shared File / Edit incident form modal — used by both the Incidents list
 * (file + edit a row) and the routable `/incidents/:id` detail page (edit in place,
 * CW-4a). Built on the shared `EntityFormModal` + `useEntityForm` primitives; org_id,
 * status, and reporter are NEVER sent (RLS + the column default + the BEFORE-INSERT
 * trigger are the authority).
 */
export const IncidentFormModal: React.FC<IncidentFormModalProps> = ({
  incident,
  onClose,
  onCreate,
  onUpdate,
  onError,
}) => {
  const isEdit = !!incident;
  const form = useEntityForm<FormValues>({
    initialValues: {
      // AC-W6-IXD-INCDATE (B-5): the dominant case is filing a same-day incident, so the
      // create form defaults the date to TODAY. Edit keeps the stored value.
      incident_date: incident?.incident_date ?? todayLocalISO(),
      type: incident?.type ?? '',
      severity: incident?.severity ?? 'Low',
      location: incident?.location ?? '',
      description: incident?.description ?? '',
    },
    validate,
    idPrefix: 'incident-form',
    // F8 (AC-IXD-FORM-F8): submit stays disabled until the required date + type are present.
    requiredFields: ['incident_date', 'type'],
  });

  const dateField = form.fieldProps('incident_date');
  const typeField = form.fieldProps('type');
  const severityField = form.fieldProps('severity');
  const locationField = form.fieldProps('location');
  const descriptionField = form.fieldProps('description');

  const errorSummary = [
    form.errors.incident_date ? { fieldId: dateField.id, message: form.errors.incident_date } : null,
    form.errors.type ? { fieldId: typeField.id, message: form.errors.type } : null,
  ].filter((x): x is { fieldId: string; message: string } => x !== null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (values) => {
      const input: IncidentInput = {
        incident_date: values.incident_date,
        type: values.type.trim(),
        severity: values.severity,
        location: values.location.trim() || undefined,
        description: values.description.trim() || undefined,
      };
      try {
        if (isEdit && incident) await onUpdate(incident.id, input);
        else await onCreate(input);
      } catch (err) {
        onError(err);
      }
    });
  };

  return (
    <EntityFormModal
      open
      title={isEdit ? 'Edit incident' : 'File incident'}
      subtitle={
        isEdit
          ? 'Update this incident report'
          : 'Record what happened. You will be stamped as the reporter.'
      }
      submitLabel={isEdit ? 'Save incident' : 'File incident'}
      onSubmit={handleSubmit}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitDisabled={!form.isComplete}
      errorSummary={errorSummary.length ? errorSummary : undefined}
    >
      <FormSection legend="What happened">
        <FormGrid>
          <TextField
            id={dateField.id}
            label="Date"
            type="date"
            required
            value={dateField.value}
            onChange={dateField.onChange}
            onBlur={dateField.onBlur}
            error={dateField.error}
          />
          <SelectField
            id={severityField.id}
            label="Severity"
            required
            value={severityField.value}
            onChange={(v) => severityField.onChange(v as IncidentSeverity)}
            onBlur={severityField.onBlur}
            options={SEVERITY_OPTIONS}
          />
          <TextField
            id={typeField.id}
            label="Type"
            required
            value={typeField.value}
            onChange={typeField.onChange}
            onBlur={typeField.onBlur}
            error={typeField.error}
            placeholder="e.g. Near Miss, Equipment Damage, Spill"
            fullWidth
          />
          <TextField
            id={locationField.id}
            label="Location"
            value={locationField.value}
            onChange={locationField.onChange}
            onBlur={locationField.onBlur}
            placeholder="e.g. Regional Site B"
            fullWidth
          />
          <TextArea
            id={descriptionField.id}
            label="Description"
            value={descriptionField.value}
            onChange={descriptionField.onChange}
            onBlur={descriptionField.onBlur}
            placeholder="What happened, who was involved, and any immediate action taken."
            fullWidth
          />
        </FormGrid>
      </FormSection>
    </EntityFormModal>
  );
};

export default IncidentFormModal;
