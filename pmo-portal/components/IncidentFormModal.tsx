import React, { useCallback, useMemo, useRef, useState } from 'react';
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
  Button,
  Icon,
} from '@/src/components/ui';
import { useProjectOptions } from '@/src/hooks/useFkOptions';
import { useProjectWorkOrders } from '@/src/hooks/useWorkOrders';
import { useAssigneeOptions, useIncidentEvidenceMutations } from '@/src/hooks/useIncidents';
import type { IncidentRow, IncidentSeverity, IncidentInput } from '@/src/lib/db/incidents';
import { DateField } from '@/src/components/ui/DateField';
import { severityLabel } from '@/src/lib/incidents/transitions';

/** Severity values for the file/edit form (the `incident_severity` enum); labels come from `severityLabel`. */
const SEVERITIES = ['Low', 'Medium', 'High', 'Critical'] as const;

interface FormValues {
  incident_date: string;
  type: string;
  severity: IncidentSeverity;
  location: string;
  description: string;
  project_id: string | null;
  work_order_id: string | null;
  assignee_id: string | null;
  action: string;
  due_date: string;
}

type Errors = Partial<Record<keyof FormValues, string>>;

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

/** The due DAY (local) → the end of that day as an ISO instant; '' → no due time. */
function dueDateToIso(date: string): string | null {
  return date ? new Date(`${date}T23:59:00`).toISOString() : null;
}
function isoToDueDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const MAX_PHOTOS = 10;

export interface IncidentFormModalProps {
  /** null = file (create); a row = edit. */
  incident: IncidentRow | null;
  onClose: () => void;
  /** Creates the record and returns it; the caller does NOT close (photos may still need to upload). */
  onCreate: (input: IncidentInput) => Promise<IncidentRow>;
  /** Called once the record and every photo are saved. */
  onCreated?: (row: IncidentRow, input: IncidentInput) => void;
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
  onCreated,
  onUpdate,
  onError,
}) => {
  const { t } = useTranslation('incidents');
  const { upload } = useIncidentEvidenceMutations();
  // Photos picked on the phone. A failed upload keeps the typed text AND the unsent photos, and offers a retry
  // without filing the issue twice (the saved record is remembered in `saved`).
  const [photos, setPhotos] = useState<File[]>([]);
  const [saved, setSaved] = useState<{ row: IncidentRow; input: IncidentInput } | null>(null);
  const [uploadFailed, setUploadFailed] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const isEdit = !!incident;
  const validate = (v: FormValues): Errors => {
    const errors: Errors = {};
    if (!v.incident_date.trim()) errors.incident_date = t('form.dateRequired', 'Incident date is required.');
    if (!v.type.trim()) errors.type = t('form.typeRequired', 'Incident type is required.');
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
      work_order_id: incident?.work_order_id ?? null,
      assignee_id: incident?.assignee_id ?? null,
      action: incident?.action ?? '',
      due_date: isoToDueDate(incident?.due_at),
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
  const actionField = form.fieldProps('action');
  const dueField = form.fieldProps('due_date');

  // Work orders of the chosen project (the database re-checks the pairing); assignees = active members.
  const workOrders = useProjectWorkOrders(form.values.project_id ?? '');
  const workOrderOptions = useMemo<ComboboxOption[]>(
    () => (workOrders.data ?? []).filter((wo) => wo.status !== 'Cancelled')
      .map((wo) => ({ value: wo.id, label: wo.wo_number ?? wo.title, sub: wo.wo_number ? wo.title : undefined })),
    [workOrders.data],
  );
  const loadWorkOrders = useCallback(async () => workOrderOptions, [workOrderOptions]);
  const { data: assigneeOptions } = useAssigneeOptions();
  const loadAssignees = useCallback(async (): Promise<ComboboxOption[]> => assigneeOptions ?? [], [assigneeOptions]);

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (values) => {
      const input: IncidentInput = {
        work_order_id: values.project_id ? values.work_order_id : null,
        assignee_id: values.assignee_id,
        action: values.action.trim() || undefined,
        due_at: dueDateToIso(values.due_date),
        incident_date: values.incident_date,
        type: values.type.trim(),
        severity: values.severity,
        location: values.location.trim() || undefined,
        description: values.description.trim() || undefined,
        project_id: values.project_id,
      };
      try {
        if (isEdit && incident) {
          await onUpdate(incident.id, input);
          return;
        }
        // File: save the record once, then the photos; a retry after a failed upload skips the record.
        const current = saved ?? { row: await onCreate(input), input };
        if (!saved) setSaved(current);
        const remaining = [...photos];
        try {
          while (remaining.length > 0) {
            await upload.mutateAsync({ incident: current.row, kind: 'at_raise', file: remaining[0] });
            remaining.shift();
            setPhotos([...remaining]);
          }
        } catch (err) {
          setUploadFailed(true);
          onError(err);
          return;
        }
        setUploadFailed(false);
        onCreated?.(current.row, current.input);
      } catch (err) {
        onError(err);
      }
    });
  };

  return (
    <EntityFormModal
      open
      title={isEdit ? t('edit', 'Edit incident') : t('file', 'File incident')}
      submitLabel={isEdit ? t('save', 'Save incident') : uploadFailed ? t('form.retryUpload', 'Retry photo upload') : t('file', 'File incident')}
      onSubmit={handleSubmit}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitDisabled={!form.isComplete}
      errorSummary={errorSummary.length ? errorSummary : undefined}
    >
      <FormSection legend={t('form.section', 'What happened')}>
        <FormGrid>
          <DateField
            id={dateField.id}
            label={t('form.date', 'Date')}
            required
            value={dateField.value}
            onChange={dateField.onChange}
            onBlur={dateField.onBlur}
            error={dateField.error}
          />
          <SelectField
            id={severityField.id}
            label={t('form.severity', 'Severity')}
            required
            value={severityField.value}
            onChange={(v) => severityField.onChange(v as IncidentSeverity)}
            onBlur={severityField.onBlur}
            options={SEVERITIES.map((s) => ({ value: s, label: severityLabel(t, s) }))}
          />
          <TextField
            id={typeField.id}
            label={t('form.type', 'Type')}
            required
            value={typeField.value}
            onChange={typeField.onChange}
            onBlur={typeField.onBlur}
            error={typeField.error}
            placeholder={t('form.typePlaceholder', 'e.g. Near Miss, Equipment Damage, Spill')}
            fullWidth
          />
          <TextField
            id={locationField.id}
            label={t('form.location', 'Location')}
            value={locationField.value}
            onChange={locationField.onChange}
            onBlur={locationField.onBlur}
            placeholder={t('form.locationPlaceholder', 'e.g. Regional Site B')}
            fullWidth
          />
          <Combobox
            label={t('form.project', 'Project')}
            noun={t('form.projectNoun', 'project')}
            placeholder={t('form.projectPlaceholder', 'Optional — link a project…')}
            value={form.values.project_id}
            selectedOption={selectedProjectOption}
            onChange={(v) => form.setValue('project_id', v)}
            loadOptions={loadProjects}
          />
          <Combobox
            label={t('form.workOrder', 'Work order')}
            noun={t('form.workOrderNoun', 'work order')}
            placeholder={form.values.project_id ? t('form.workOrderPlaceholder', 'Optional — name a work order…') : t('form.workOrderNeedsProject', 'Choose a project first')}
            value={form.values.work_order_id}
            selectedOption={workOrderOptions.find((o) => o.value === form.values.work_order_id) ?? null}
            onChange={(v) => form.setValue('work_order_id', v || null)}
            loadOptions={loadWorkOrders}
            disabled={!form.values.project_id}
            clearable
            onClear={() => form.setValue('work_order_id', null)}
          />
          <Combobox
            label={t('form.assignee', 'Person in charge')}
            noun={t('form.assigneeNoun', 'person')}
            placeholder={t('form.assigneePlaceholder', 'Optional — who must fix it…')}
            value={form.values.assignee_id}
            selectedOption={(assigneeOptions ?? []).find((o) => o.value === form.values.assignee_id) ?? null}
            onChange={(v) => form.setValue('assignee_id', v || null)}
            loadOptions={loadAssignees}
            clearable
            onClear={() => form.setValue('assignee_id', null)}
          />
          <DateField
            id={dueField.id}
            label={t('form.due', 'Fix by')}
            value={dueField.value}
            onChange={dueField.onChange}
            onBlur={dueField.onBlur}
            error={dueField.error}
          />
          <TextField
            id={actionField.id}
            label={t('form.action', 'What must be done')}
            value={actionField.value}
            onChange={actionField.onChange}
            onBlur={actionField.onBlur}
            placeholder={t('form.actionPlaceholder', 'e.g. Replace the damaged guard rail')}
            fullWidth
          />
          <TextArea
            id={descriptionField.id}
            label={t('form.description', 'Description')}
            value={descriptionField.value}
            onChange={descriptionField.onChange}
            onBlur={descriptionField.onBlur}
            placeholder={t('form.descriptionPlaceholder', 'What happened, who was involved, and any immediate action taken.')}
            fullWidth
          />
        </FormGrid>
      </FormSection>
      {!isEdit && (
        <FormSection legend={t('form.photos', 'Photos')}>
          {/* Opens the phone camera; on a desktop it is an ordinary file picker. Up to 10, 15 MB each. */}
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            hidden
            data-testid="incident-photo-input"
            aria-label={t('form.addPhoto', 'Add photo')}
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []);
              setPhotos((prev) => [...prev, ...picked].slice(0, MAX_PHOTOS));
              e.target.value = '';
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={photos.length >= MAX_PHOTOS} onClick={() => fileInput.current?.click()}>
              <Icon name="plus" />
              {t('form.addPhoto', 'Add photo')}
            </Button>
            <span className="text-control text-muted-foreground">{t('form.photoHint', 'Up to 10 photos, 15 MB each.')}</span>
          </div>
          {photos.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1" aria-label={t('form.photos', 'Photos')}>
              {photos.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 text-control">
                  <span className="truncate">{f.name}</span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}>
                    {t('form.removePhoto', 'Remove')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {uploadFailed && (
            <p role="alert" className="mt-2 text-control text-destructive">
              {t('form.uploadFailed', 'The issue was saved, but a photo could not be uploaded. Your text is kept — retry to send the remaining photos.')}
            </p>
          )}
        </FormSection>
      )}
    </EntityFormModal>
  );
};

export default IncidentFormModal;
