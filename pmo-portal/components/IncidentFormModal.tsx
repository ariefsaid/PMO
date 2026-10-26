import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  EntityFormModal,
  TextField,
  TextArea,
  SelectField,
  Combobox,
  FormSection,
  FormGrid,
  useEntityForm,
  type ComboboxOption,
} from '@/src/components/ui';
import { useProjectOptions } from '@/src/hooks/useFkOptions';
import type { IncidentRow, IncidentSeverity, IncidentInput } from '@/src/lib/db/incidents';

interface FormValues {
  incident_date: string;
  type: string;
  severity: IncidentSeverity;
  location: string;
  description: string;
  project_id: string | null;
}

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
  const { t } = useTranslation();
  const isEdit = !!incident;
  const validate = (values: FormValues): Partial<Record<keyof FormValues, string>> => {
    const errors: Partial<Record<keyof FormValues, string>> = {};
    if (!values.incident_date.trim()) errors.incident_date = t('incidents.form.dateRequired', 'Incident date is required.');
    if (!values.type.trim()) errors.type = t('incidents.form.typeRequired', 'Incident type is required.');
    return errors;
  };
  const form = useEntityForm<FormValues>({
    initialValues: {
      // AC-W6-IXD-INCDATE (B-5): the dominant case is filing a same-day incident, so the
      // create form defaults the date to TODAY. Edit keeps the stored value.
      incident_date: incident?.incident_date ?? todayLocalISO(),
      type: incident?.type ?? '',
      severity: incident?.severity ?? 'Low',
      location: incident?.location ?? '',
      description: incident?.description ?? '',
      project_id: incident?.project_id ?? null,
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

  // Optional project link. FK options come from the cached hook (no re-fetch on popover open);
  // the loader just hands back the already-fetched list. org_id is never threaded (RLS scopes it).
  const { data: projectOptions } = useProjectOptions();
  const loadProjects = useCallback(
    async (): Promise<ComboboxOption[]> => projectOptions ?? [],
    [projectOptions],
  );
  // Resolve the selected option so an edit form renders the linked project's name immediately,
  // without waiting for loadOptions to resolve.
  const selectedProjectOption = useMemo(
    () =>
      form.values.project_id
        ? (projectOptions ?? []).find((o) => o.value === form.values.project_id) ?? null
        : null,
    [form.values.project_id, projectOptions],
  );

  const errorSummary = [
    form.errors.incident_date ? { fieldId: dateField.id, message: form.errors.incident_date } : null,
    form.errors.type ? { fieldId: typeField.id, message: form.errors.type } : null,
  ].filter((x): x is { fieldId: string; message: string } => x !== null);
  const severityOptions = [
    { value: 'Low', label: t('incidents.severity.low', 'Low') },
    { value: 'Medium', label: t('incidents.severity.medium', 'Medium') },
    { value: 'High', label: t('incidents.severity.high', 'High') },
    { value: 'Critical', label: t('incidents.severity.critical', 'Critical') },
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (values) => {
      const input: IncidentInput = {
        incident_date: values.incident_date,
        type: values.type.trim(),
        severity: values.severity,
        location: values.location.trim() || undefined,
        description: values.description.trim() || undefined,
        project_id: values.project_id,
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
      title={isEdit ? t('incidents.form.title.edit', 'Edit incident') : t('incidents.form.title.create', 'File incident')}
      subtitle={
        isEdit
          ? t('incidents.form.subtitle.edit', 'Update this incident report')
          : t('incidents.form.subtitle.create', 'Record what happened. You will be recorded as the reporter.')
      }
      submitLabel={isEdit ? t('incidents.form.save', 'Save incident') : t('incidents.form.submit', 'File incident')}
      onSubmit={handleSubmit}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitDisabled={!form.isComplete}
      errorSummary={errorSummary.length ? errorSummary : undefined}
    >
      <FormSection legend={t('incidents.form.section', 'What happened')}>
        <FormGrid className="[&_input]:min-h-11 [&_button]:min-h-11 [&_select]:min-h-11 [&_textarea]:min-h-28">
          <TextField
            id={dateField.id}
            label={t('incidents.columns.date', 'Date')}
            type="date"
            required
            value={dateField.value}
            onChange={dateField.onChange}
            onBlur={dateField.onBlur}
            error={dateField.error}
          />
          <SelectField
            id={severityField.id}
            label={t('incidents.columns.severity', 'Severity')}
            required
            value={severityField.value}
            onChange={(v) => severityField.onChange(v as IncidentSeverity)}
            onBlur={severityField.onBlur}
            options={severityOptions}
          />
          <TextField
            id={typeField.id}
            label={t('incidents.form.type', 'Type')}
            required
            value={typeField.value}
            onChange={typeField.onChange}
            onBlur={typeField.onBlur}
            error={typeField.error}
            placeholder={t('incidents.form.typePlaceholder', 'e.g. Near Miss, Equipment Damage, Spill')}
            fullWidth
          />
          <TextField
            id={locationField.id}
            label={t('incidents.columns.location', 'Location')}
            value={locationField.value}
            onChange={locationField.onChange}
            onBlur={locationField.onBlur}
            placeholder={t('incidents.form.locationPlaceholder', 'e.g. Office or work site')}
            fullWidth
          />
          <Combobox
            label={t('incidents.columns.project', 'Project')}
            noun={t('incidents.form.projectNoun', 'project')}
            placeholder={t('incidents.form.projectPlaceholder', 'Optional — link a project…')}
            value={form.values.project_id}
            selectedOption={selectedProjectOption}
            onChange={(v) => form.setValue('project_id', v)}
            loadOptions={loadProjects}
          />
          <TextArea
            id={descriptionField.id}
            label={t('incidents.form.description', 'Description')}
            value={descriptionField.value}
            onChange={descriptionField.onChange}
            onBlur={descriptionField.onBlur}
            placeholder={t('incidents.form.descriptionPlaceholder', 'What happened, who was involved, and any immediate action taken.')}
            fullWidth
          />
        </FormGrid>
      </FormSection>
    </EntityFormModal>
  );
};

export default IncidentFormModal;
