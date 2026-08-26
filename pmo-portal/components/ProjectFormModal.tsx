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
import { parseMoneyInput } from '@/src/lib/format';
import {
  TAX_TREATMENT_OPTIONS,
  TAX_TREATMENT_PLACEHOLDER,
  CONTRACT_TAX_REQUIRED_HINT,
  parseTaxFacts,
} from '@/src/lib/taxTreatment';
import { useOrgTaxDefault, useTaxTreatmentPreselect } from '@/src/hooks/useOrgTaxDefault';
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
  /**
   * #513: the basis the estimated value is stated on. ⛔ Starts EMPTY and gets no default — a
   * defaulted marker is a WRONG value indistinguishable from a deliberate one, which is the defect
   * migration 0197 exists to remove. Required only when the value is non-zero (see
   * `needsTaxBasis`): a project originated at 0 states nothing and is asked nothing, exactly as the
   * DB CHECK is written.
   */
  taxTreatment: string;
  taxAmount: string;
  startDate: string;
  endDate: string;
}

/**
 * Does an entered estimated value oblige the user to state its tax basis? Mirrors 0197's
 * `check (contract_value = 0 or (tax_treatment is not null and tax_amount is not null))` — blank
 * and 0 are exempt, everything else is not. Unparseable input is NOT treated as needing a basis:
 * `moneyError` already blocks the submit with a format error, and demanding a tax treatment on top
 * of "that isn't a number" is noise.
 */
function needsTaxBasis(valueRaw: string): boolean {
  const n = parseMoneyInput(valueRaw);
  return n !== null && n > 0;
}

const ORIGINATION_OPTIONS = PROJECT_ORIGINATION_STATUSES.map((s) => ({ value: s, label: s }));

/**
 * "Estimated value" is OPTIONAL (a pre-win estimate may be unset). Blank → valid (unset).
 * Non-blank must parse (via the SAME `parseMoneyInput` used to persist — Wave 3 input integrity)
 * to a finite, non-negative number; otherwise an inline error blocks the submit.
 */
function moneyError(raw: string): string | undefined {
  if (!raw.trim()) return undefined; // optional — blank is fine
  const n = parseMoneyInput(raw);
  return n === null || n < 0
    ? 'Enter a valid non-negative number (e.g. 1,500,000).'
    : undefined;
}

const validate = (v: FormValues): Partial<Record<keyof FormValues, string>> => {
  const errors: Partial<Record<keyof FormValues, string>> = {};
  if (!v.name.trim()) errors.name = 'Project name is required.';
  if (!v.clientId) errors.clientId = 'Select a client company.';
  const valueErr = moneyError(v.value);
  if (valueErr) errors.value = valueErr;
  return errors;
};

export interface ProjectFormModalProps {
  /** Omit (or 'create') for a new project; 'editHeader' to edit an existing project. */
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
      taxTreatment: '',
      taxAmount: '',
      startDate: initial?.start_date ?? '',
      endDate: initial?.end_date ?? '',
    },
    validate,
    idPrefix: 'project-form',
    // F8 (AC-IXD-FORM-F8): submit stays disabled until the required name + client
    // are present. The optional estimated value is NOT required — a bad value is a
    // format error caught on submit (focus moves to it), not a completeness gate.
    requiredFields: ['name', 'clientId'],
  });

  // The combobox tracks its own selected-label so the chip renders without a
  // separate fetch (seeded from initial for edit, then updated on selection).
  const [clientLabel, setClientLabel] = useState<string | null>(initial?.clientName ?? null);
  const [pmLabel, setPmLabel] = useState<string | null>(initial?.pmName ?? null);

  const nameField = form.fieldProps('name');
  const codeField = form.fieldProps('code');
  const statusField = form.fieldProps('status');
  const valueField = form.fieldProps('value');
  const taxTreatmentField = form.fieldProps('taxTreatment');
  const taxAmountField = form.fieldProps('taxAmount');

  // #513: the ONE predicate — Create stays disabled AND `handleSubmit` refuses while a non-zero
  // value has no stated basis, so the button state and the guard can never disagree. Never applies
  // in editHeader mode: that form does not write `contract_value` at all (SoD → the detail-header
  // RPC), so it has no basis to state.
  const taxRequired = !isEdit && needsTaxBasis(form.values.value);

  // OD-TAX-1 (#548): the org's `default_tax_treatment` PRE-SELECTS this control on a NEW project, so
  // an org that quotes exclusive every day is not re-asked the same question daily and the uncommon
  // basis stays a visible choice rather than a silent one. It seeds an EMPTY control once and never
  // overwrites an answer (`useTaxTreatmentPreselect`), and it seeds nothing at all when the org row
  // cannot be read — so the #513 submit guard below still blocks rather than passing a marker
  // nobody chose. ⛔ Never in `editHeader` mode: that form writes no `contract_value`, so there is
  // no new figure for a default to describe, and pre-selecting there would put the CURRENT org
  // setting on an OLD row's basis — the read-time inference OD-TAX-1 forbids outright.
  const orgTaxDefault = useOrgTaxDefault();
  useTaxTreatmentPreselect(
    orgTaxDefault,
    form.values.taxTreatment,
    (v) => form.setValue('taxTreatment', v),
    !isEdit,
  );
  const parsedTax = parseTaxFacts(form.values.taxTreatment, form.values.taxAmount);
  const taxIncomplete = taxRequired && parsedTax === null;
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
  // F8 (AC-IXD-FORM-F8): the value (estimated contract) field can carry a FORMAT
  // error (non-blank but unparseable) — it is anchored here so a still-invalid
  // submit moves focus to it (the completeness gate cannot block a non-blank field).
  const errorSummary = [
    form.errors.name ? { fieldId: nameField.id, message: form.errors.name } : null,
    form.errors.clientId ? { fieldId: nameField.id, message: form.errors.clientId } : null,
    form.errors.value ? { fieldId: valueField.id, message: form.errors.value } : null,
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
          const base = {
            name: values.name.trim(),
            status: values.status,
            client_id: values.clientId,
            project_manager_id: values.pmId,
            start_date: values.startDate || null,
            end_date: values.endDate || null,
          };
          const contractValue = parseMoneyInput(values.value) ?? 0;
          // #513: the basis travels WITH the value or the value is 0. `CreateProjectInput` is a
          // union on exactly this rule, so the branch below is not defensive style — it is the only
          // shape that compiles, and a non-zero value with no basis cannot be built here.
          let input: CreateProjectInput;
          if (contractValue > 0) {
            const tax = parseTaxFacts(values.taxTreatment, values.taxAmount);
            // Unreachable through the UI (Create is disabled, and this shares `parseTaxFacts` with
            // the predicate that disables it) — but a bare `return` would make a future regression a
            // DEAD BUTTON with no message. Unreachable code that fails loudly costs nothing.
            if (!tax) {
              throw new Error(
                'a contract value cannot be created without its tax treatment — the submit guard and '
                + 'this check share one predicate, so reaching here means they have diverged',
              );
            }
            input = {
              ...base,
              contract_value: contractValue,
              tax_treatment: tax.taxTreatment,
              tax_amount: tax.taxAmount,
            };
          } else {
            input = { ...base, contract_value: 0 };
          }
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
      title={isEdit ? 'Edit project' : 'New project'}
      subtitle={
        isEdit ? 'Update the project header details' : 'Create a project'
      }
      submitLabel={isEdit ? 'Save project' : 'Create project'}
      onSubmit={handleSubmit}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitDisabled={!form.isComplete || taxIncomplete}
      errorSummary={errorSummary.length ? errorSummary : undefined}
    >
      <FormSection legend="Project">
        <FormGrid>
          <TextField
            id={nameField.id}
            label="Project name"
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
                helper="On-hand is reached only by winning a project in the pipeline, never created directly."
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
              {/* #513: asked ONLY once a non-zero value is entered — a project originated at 0
                  states nothing and is asked nothing (migration 0197's conditional CHECK). No
                  pre-selected treatment: the select starts empty and Create stays disabled, with
                  the hint below saying why. Options/placeholder/parse are single-sourced in
                  src/lib/taxTreatment.ts, shared with the vendor-invoice forms. */}
              {taxRequired && (
                <>
                  <SelectField
                    id={taxTreatmentField.id}
                    label="Tax treatment"
                    required
                    value={taxTreatmentField.value}
                    onChange={taxTreatmentField.onChange}
                    placeholder={TAX_TREATMENT_PLACEHOLDER}
                    options={TAX_TREATMENT_OPTIONS}
                    data-testid="project-tax-treatment"
                  />
                  <NumberField
                    id={taxAmountField.id}
                    label="Tax amount"
                    required
                    prefix="$"
                    value={taxAmountField.value}
                    onChange={taxAmountField.onChange}
                    onBlur={taxAmountField.onBlur}
                    placeholder="0"
                    data-testid="project-tax-amount"
                  />
                  {taxIncomplete && (
                    <p
                      data-testid="project-tax-required-hint"
                      className="col-span-full text-[12px] text-muted-foreground"
                    >
                      {CONTRACT_TAX_REQUIRED_HINT}
                    </p>
                  )}
                </>
              )}
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
