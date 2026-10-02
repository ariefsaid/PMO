import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useProjectStatusLabel } from '@/src/hooks/useProjectStatusLabel';
import type { TFunction } from 'i18next';
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
import { useCompanies } from '@/src/hooks/useCompanies';
import {
  currencySymbol,
  formatMoneyInputValue,
  moneyInputErrorKind,
  numberSymbols,
  parseMoneyInput,
  parseMoneyInputAtScale,
} from '@/src/lib/format';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import { CONTRACT_TAX_REQUIRED_HINT, parseTaxFacts } from '@/src/lib/taxTreatment';
import { useOrgTaxDefault, useTaxTreatmentPreselect } from '@/src/hooks/useOrgTaxDefault';
import { useTaxTreatmentOptions } from '@/src/hooks/useTaxTreatmentOptions';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
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
  /** The end customer (#758) — nullable like the client; `endClientName` seeds the chip label. */
  end_client_id?: string | null;
  endClientName?: string | null;
  pmName?: string | null;
  start_date?: string | null;
  end_date?: string | null;
}

interface FormValues {
  name: string;
  code: string;
  clientId: string | null;
  endClientId: string | null;
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

/**
 * "Estimated value" is OPTIONAL (a pre-win estimate may be unset). Blank → valid (unset).
 * Non-blank must parse (via the same locale-aware scale-2 parser used to persist — Wave 3 input
 * integrity) to a finite, non-negative number; otherwise an inline error blocks the submit.
 *
 * #684 AC-PLC-010/FR-PLC-010: a value that fails to parse AT ALL (wrong separators for the
 * viewer's convention — `1,234.56` under `id-ID`, or a pasted `1234567.89` whose grouping matches
 * neither convention) is a FORMAT mistake, not a precision one — it is told apart from a value
 * that parses correctly but carries more fractional digits than the target column can store, and
 * each gets its own message naming what actually went wrong.
 */
function moneyError(raw: string, t: TFunction, locale = getNumberLocale()): string | undefined {
  if (!raw.trim()) return undefined; // optional — blank is fine
  const n = parseMoneyInputAtScale(raw, 2, locale);
  if (n !== null && n >= 0) return undefined;
  if (moneyInputErrorKind(raw, 2, locale) === 'format') {
    const { decimal, group } = numberSymbols(locale);
    return t('projectForm.value.formatError', {
      defaultValue: 'Use "{{group}}" to group thousands and "{{decimal}}" for decimals — for example {{example}}.',
      group,
      decimal,
      example: formatMoneyInputValue(1234.56, locale),
    });
  }
  return t('projectDetail.header.invalidContractValue', 'Enter a valid non-negative amount with no more than 2 decimal places.');
}

const makeValidate =
  (t: TFunction) =>
  (v: FormValues): Partial<Record<keyof FormValues, string>> => {
    const errors: Partial<Record<keyof FormValues, string>> = {};
    if (!v.name.trim()) errors.name = t('projectForm.name.required', 'Project name is required.');
    if (!v.clientId) errors.clientId = t('projectForm.client.required', 'Select a client company.');
    const valueErr = moneyError(v.value, t);
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
  const { t } = useTranslation();
  const statusLabel = useProjectStatusLabel();
  const originationOptions = PROJECT_ORIGINATION_STATUSES.map((s) => ({ value: s, label: statusLabel(s) }));
  const validate = useMemo(() => makeValidate(t), [t]);
  const taxOptions = useTaxTreatmentOptions();
  const { data: clients = [], isError: clientsError } = useClientCompanies();
  const { data: managers = [], isError: pmError } = useProjectManagers();
  // #758: the end customer can be ANY of the org's companies (not just Client-type), so it uses
  // the broad useCompanies() cache rather than useClientCompanies().
  const { data: allCompanies = [], isError: endCustomersError } = useCompanies();

  const form = useEntityForm<FormValues>({
    initialValues: {
      name: initial?.name ?? '',
      code: initial?.code ?? '',
      clientId: initial?.client_id ?? null,
      endClientId: initial?.end_client_id ?? null,
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
  const [endClientLabel, setEndClientLabel] = useState<string | null>(initial?.endClientName ?? null);

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
  // #694: a new project takes the org's currency (migration 0187), so that is the adornment.
  const moneyPrefix = currencySymbol(useOrgCurrency());
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
      sub: t('companies.type.client', 'Client'),
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

  const loadEndCustomers = async (): Promise<ComboboxOption[]> => {
    if (endCustomersError) throw new Error('end customer load failed');
    return allCompanies.map((c) => ({
      value: c.id,
      label: c.name,
      sub: t(`companies.type.${c.type.toLowerCase()}`, c.type),
      initials: initialsOf(c.name),
      color: projectIconColor(),
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
            end_client_id: values.endClientId,
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
            end_client_id: values.endClientId,
            project_manager_id: values.pmId,
            start_date: values.startDate || null,
            end_date: values.endDate || null,
          };
          const contractValue = parseMoneyInputAtScale(values.value, 2) ?? 0;
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
      title={isEdit ? t('projectForm.title.edit', 'Edit project') : t('projectForm.title.create', 'New project')}
      subtitle={
        isEdit
          ? t('projectForm.subtitle.edit', 'Update the project header details')
          : t('projectForm.subtitle.create', 'Create a project')
      }
      submitLabel={isEdit ? t('projectForm.submit.edit', 'Save project') : t('projectForm.submit.create', 'Create project')}
      onSubmit={handleSubmit}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitDisabled={!form.isComplete || taxIncomplete}
      errorSummary={errorSummary.length ? errorSummary : undefined}
    >
      <FormSection legend={t('projectForm.section.project', 'Project')}>
        <FormGrid>
          <TextField
            id={nameField.id}
            label={t('projectForm.name.label', 'Project name')}
            required
            value={nameField.value}
            onChange={nameField.onChange}
            onBlur={nameField.onBlur}
            error={nameField.error}
            placeholder={t('projectForm.name.placeholder', 'e.g. Harborside Terminal — Civil Works')}
            fullWidth
          />

          <Combobox
            label={t('projectForm.client.label', 'Client company')}
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
            placeholder={t('projectForm.client.placeholder', 'Select a company…')}
            searchPlaceholder={t('projectForm.client.search', 'Search companies…')}
            noun={t('projectForm.client.noun', 'company')}
            error={form.errors.clientId}
          />

          {/* #758: optional end customer (the company the work is ultimately for). NOT required;
              lists the org's companies; clearable back to null. Sits directly after Client. */}
          <Combobox
            label={t('projectForm.endCustomer.label', 'End customer')}
            value={form.values.endClientId}
            selectedOption={
              form.values.endClientId && endClientLabel
                ? { value: form.values.endClientId, label: endClientLabel, initials: initialsOf(endClientLabel), color: projectIconColor() }
                : null
            }
            onChange={(v, opt) => {
              form.setValue('endClientId', v);
              setEndClientLabel(opt.label);
            }}
            onClear={() => {
              form.setValue('endClientId', null);
              setEndClientLabel(null);
            }}
            clearable
            loadOptions={loadEndCustomers}
            placeholder={t('projectForm.endCustomer.placeholder', 'Select a company…')}
            searchPlaceholder={t('projectForm.endCustomer.search', 'Search companies…')}
            noun={t('projectForm.endCustomer.noun', 'company')}
          />

          <Combobox
            label={t('projectForm.pm.label', 'Project manager')}
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
            placeholder={t('projectForm.pm.placeholder', 'Assign a PM…')}
            noun={t('projectForm.pm.noun', 'manager')}
          />

          {isEdit ? (
            <TextField
              id={codeField.id}
              label={t('projectForm.code.label', 'Project code')}
              value={codeField.value}
              onChange={codeField.onChange}
              onBlur={codeField.onBlur}
              placeholder={t('projectForm.code.placeholder', 'e.g. OPP-2041')}
              mono
            />
          ) : (
            <>
              <SelectField
                id={statusField.id}
                label={t('projectForm.stage.label', 'Origination stage')}
                value={statusField.value}
                onChange={(v) => statusField.onChange(v as ProjectStatus)}
                options={originationOptions}
                helper={t('projectForm.stage.helper', 'On-hand is reached only by winning a project in the pipeline, never created directly.')}
              />
              <NumberField
                id={valueField.id}
                label={t('projectForm.estimatedValue', 'Estimated value')}
                prefix={moneyPrefix}
                value={valueField.value}
                onChange={valueField.onChange}
                onBlur={valueField.onBlur}
                error={valueField.error}
                localeAware
                placeholder="0"
                helper={t('projectForm.value.helper', 'Estimate, pre-win. Editable by Admin, Executive, and PM.')}
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
                    label={t('projectDetail.header.taxTreatment', 'Tax treatment')}
                    required
                    value={taxTreatmentField.value}
                    onChange={taxTreatmentField.onChange}
                    placeholder={taxOptions.placeholder}
                    options={taxOptions.options}
                    data-testid="project-tax-treatment"
                  />
                  <NumberField
                    id={taxAmountField.id}
                    label={t('projectDetail.header.taxAmount', 'Tax amount')}
                    required
                    prefix={moneyPrefix}
                    value={taxAmountField.value}
                    onChange={taxAmountField.onChange}
                    onBlur={taxAmountField.onBlur}
                    localeAware
                    placeholder="0"
                    data-testid="project-tax-amount"
                  />
                  {taxIncomplete && (
                    <p
                      data-testid="project-tax-required-hint"
                      className="col-span-full text-[12px] text-muted-foreground"
                    >
                      {t('projectForm.taxRequiredHint', CONTRACT_TAX_REQUIRED_HINT)}
                    </p>
                  )}
                </>
              )}
            </>
          )}
        </FormGrid>
      </FormSection>

      <FormSection legend={t('projectForm.section.schedule', 'Schedule')}>
        <FormGrid>
          <TextField
            id={startField.id}
            label={t('projectForm.expectedStart', 'Expected start')}
            type="date"
            value={startField.value}
            onChange={startField.onChange}
          />
          <TextField
            id={endField.id}
            label={t('projectForm.expectedEnd', 'Expected end')}
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
