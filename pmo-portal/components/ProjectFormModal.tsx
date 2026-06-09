import React, { useState } from 'react';
import {
  EntityFormModal,
  TextField,
  NumberField,
  SelectField,
  Combobox,
  FormSection,
  FormGrid,
  useEntityForm,
  type ComboboxOption,
} from '@/src/components/ui';
import { useClientCompanies, useProjectManagers } from '@/src/hooks/useProjects';
import { projectIconColor } from './projects';
import {
  PROJECT_ORIGINATION_STATUSES,
  type CreateProjectInput,
  type ProjectHeaderInput,
  type ProjectStatus,
} from '@/src/lib/db/projects';

// ---------------------------------------------------------------------------
// ProjectFormModal — the New-deal create form AND the edit-header form
// (crud-components §9.1, §3; mockup crud-project-form.html §A). One reusable
// EntityFormModal:
//   • mode="create"      → name + client (Combobox FK) + PM (Combobox FK) +
//                          origination stage (Leads / Internal Project ONLY —
//                          on-hand is reached only via the win-transition) +
//                          estimated contract value + customer code + dates.
//   • mode="editHeader"  → name + code + client + PM + dates. NO contract_value
//                          (SoD-gated → the InlineEditField on the detail header),
//                          NO status (the lifecycle control / win-transition owns it).
// Strictly DESIGN.md-tokened (it composes the shipped form primitives only).
// ---------------------------------------------------------------------------

/** A two-letter avatar for a combobox option (client / PM chips). */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Pre-filled values when editing an existing project header. */
export interface ProjectFormInitial {
  id: string;
  name: string;
  code: string | null;
  client_id: string | null;
  project_manager_id: string | null;
  clientName?: string | null;
  pmName?: string | null;
  start_date?: string | null;
  end_date?: string | null;
}

interface FormValues {
  name: string;
  code: string;
  clientId: string | null;
  pmId: string | null;
  status: ProjectStatus;
  value: string;
  startDate: string;
  endDate: string;
}

const ORIGINATION_OPTIONS = PROJECT_ORIGINATION_STATUSES.map((s) => ({ value: s, label: s }));

/**
 * Return true when the raw money string is valid: either blank (optional) or a
 * string that parses to a finite, non-negative number after stripping commas.
 */
function isValidMoneyInput(raw: string): boolean {
  if (!raw.trim()) return true; // optional — blank is fine
  const stripped = raw.replace(/,/g, '');
  const n = Number(stripped);
  return Number.isFinite(n) && n >= 0;
}

const validate = (v: FormValues): Partial<Record<keyof FormValues, string>> => {
  const errors: Partial<Record<keyof FormValues, string>> = {};
  if (!v.name.trim()) errors.name = 'Opportunity name is required.';
  if (!v.clientId) errors.clientId = 'Select a client company.';
  if (!isValidMoneyInput(v.value))
    errors.value = 'Enter a valid non-negative number (e.g. 1,500,000).';
  return errors;
};

/** Parse a formatted money string ("4,820,000") to a number; empty → 0. */
function parseMoney(raw: string): number {
  const n = Number(raw.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export interface ProjectFormModalProps {
  /** Omit (or 'create') for a new deal; 'editHeader' to edit an existing project. */
  mode?: 'create' | 'editHeader';
  /** The project being edited (required for mode="editHeader"). */
  initial?: ProjectFormInitial;
  onClose: () => void;
  /** Create handler — receives the full CreateProjectInput (mode="create"). */
  onSubmit?: (input: CreateProjectInput) => Promise<void>;
  /** Edit-header handler — receives id + ProjectHeaderInput (mode="editHeader"). */
  onSave?: (id: string, input: ProjectHeaderInput) => Promise<void>;
  onError: (err: unknown) => void;
}

const ProjectFormModal: React.FC<ProjectFormModalProps> = ({
  mode = 'create',
  initial,
  onClose,
  onSubmit,
  onSave,
  onError,
}) => {
  const isEdit = mode === 'editHeader';
  const { data: clients = [], isError: clientsError } = useClientCompanies();
  const { data: managers = [], isError: pmError } = useProjectManagers();

  const form = useEntityForm<FormValues>({
    initialValues: {
      name: initial?.name ?? '',
      code: initial?.code ?? '',
      clientId: initial?.client_id ?? null,
      pmId: initial?.project_manager_id ?? null,
      status: 'Leads',
      value: '',
      startDate: initial?.start_date ?? '',
      endDate: initial?.end_date ?? '',
    },
    validate,
    idPrefix: 'project-form',
  });

  // The combobox tracks its own selected-label so the chip renders without a
  // separate fetch (seeded from initial for edit, then updated on selection).
  const [clientLabel, setClientLabel] = useState<string | null>(initial?.clientName ?? null);
  const [pmLabel, setPmLabel] = useState<string | null>(initial?.pmName ?? null);

  const nameField = form.fieldProps('name');
  const codeField = form.fieldProps('code');
  const statusField = form.fieldProps('status');
  const valueField = form.fieldProps('value');
  const startField = form.fieldProps('startDate');
  const endField = form.fieldProps('endDate');

  const loadClients = async (): Promise<ComboboxOption[]> => {
    if (clientsError) throw new Error('client load failed');
    return clients.map((c) => ({
      value: c.id,
      label: c.name,
      sub: 'Client',
      initials: initialsOf(c.name),
      color: projectIconColor(),
    }));
  };

  const loadManagers = async (): Promise<ComboboxOption[]> => {
    if (pmError) throw new Error('pm load failed');
    return managers.map((m) => ({
      value: m.id,
      label: m.full_name,
      initials: initialsOf(m.full_name),
      color: 'hsl(var(--secondary-foreground))',
    }));
  };

  // The error summary anchors the name field (a stable id); the client error renders
  // inline on the Combobox (its trigger id is component-generated). Both fields still
  // show their own inline role="alert" message — the summary is the focus-management
  // affordance for the first focusable field with a known id.
  const errorSummary = [
    form.errors.name ? { fieldId: nameField.id, message: form.errors.name } : null,
    form.errors.clientId ? { fieldId: nameField.id, message: form.errors.clientId } : null,
  ].filter((x): x is { fieldId: string; message: string } => x != null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (values) => {
      try {
        if (isEdit && initial && onSave) {
          const input: ProjectHeaderInput = {
            name: values.name.trim(),
            code: values.code.trim() || null,
            client_id: values.clientId,
            project_manager_id: values.pmId,
            start_date: values.startDate || null,
            end_date: values.endDate || null,
          };
          await onSave(initial.id, input);
        } else if (onSubmit) {
          const input: CreateProjectInput = {
            name: values.name.trim(),
            status: values.status,
            client_id: values.clientId,
            project_manager_id: values.pmId,
            contract_value: parseMoney(values.value),
            start_date: values.startDate || null,
            end_date: values.endDate || null,
          };
          await onSubmit(input);
        }
      } catch (err) {
        onError(err);
      }
    });
  };

  return (
    <EntityFormModal
      open
      title={isEdit ? 'Edit project' : 'New deal'}
      subtitle={
        isEdit ? 'Update the project header details' : 'Create an opportunity in the sales pipeline'
      }
      submitLabel={isEdit ? 'Save project' : 'Create deal'}
      onSubmit={handleSubmit}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      errorSummary={errorSummary.length ? errorSummary : undefined}
    >
      <FormSection legend="Opportunity">
        <FormGrid>
          <TextField
            id={nameField.id}
            label="Opportunity name"
            required
            value={nameField.value}
            onChange={nameField.onChange}
            onBlur={nameField.onBlur}
            error={nameField.error}
            placeholder="e.g. Harborside Terminal — Civil Works"
            fullWidth
          />

          <Combobox
            label="Client company"
            required
            value={form.values.clientId}
            selectedOption={
              form.values.clientId && clientLabel
                ? { value: form.values.clientId, label: clientLabel, initials: initialsOf(clientLabel), color: projectIconColor() }
                : null
            }
            onChange={(v, opt) => {
              form.setValue('clientId', v);
              setClientLabel(opt.label);
            }}
            loadOptions={loadClients}
            placeholder="Select a company…"
            searchPlaceholder="Search companies…"
            noun="company"
            error={form.errors.clientId}
          />

          <Combobox
            label="Project manager"
            value={form.values.pmId}
            selectedOption={
              form.values.pmId && pmLabel
                ? { value: form.values.pmId, label: pmLabel, initials: initialsOf(pmLabel) }
                : null
            }
            onChange={(v, opt) => {
              form.setValue('pmId', v);
              setPmLabel(opt.label);
            }}
            loadOptions={loadManagers}
            placeholder="Assign a PM…"
            noun="manager"
          />

          {isEdit ? (
            <TextField
              id={codeField.id}
              label="Project code"
              value={codeField.value}
              onChange={codeField.onChange}
              onBlur={codeField.onBlur}
              placeholder="e.g. OPP-2041"
              mono
            />
          ) : (
            <>
              <SelectField
                id={statusField.id}
                label="Origination stage"
                value={statusField.value}
                onChange={(v) => statusField.onChange(v as ProjectStatus)}
                options={ORIGINATION_OPTIONS}
                helper="On-hand is reached only by winning a deal, never created directly."
              />
              <NumberField
                id={valueField.id}
                label="Estimated value"
                prefix="$"
                value={valueField.value}
                onChange={valueField.onChange}
                onBlur={valueField.onBlur}
                error={valueField.error}
                placeholder="0"
                helper="Estimate, pre-win. Editable by Admin, Executive, and PM."
              />
            </>
          )}
        </FormGrid>
      </FormSection>

      <FormSection legend="Schedule">
        <FormGrid>
          <TextField
            id={startField.id}
            label="Expected start"
            type="date"
            value={startField.value}
            onChange={startField.onChange}
          />
          <TextField
            id={endField.id}
            label="Expected end"
            type="date"
            value={endField.value}
            onChange={endField.onChange}
          />
        </FormGrid>
      </FormSection>
    </EntityFormModal>
  );
};

export default ProjectFormModal;
