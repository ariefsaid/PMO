import { useProjectClassificationOptions } from '@/src/hooks/useProjectClassificationOptions';
import type { ProjectClassification } from '@/src/lib/projectClassification';
import { TaxRateFields } from '@/src/components/ui/TaxRateFields';
import { useStandaloneTaxFields } from '@/src/hooks/useStandaloneTaxFields';
import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  FormActions,
  Icon,
  useEntityForm,
  type ComboboxOption,
} from '@/src/components/ui';
import { useClientCompanies, useProjectManagers } from '@/src/hooks/useProjects';
import { useProjectNumberProposal } from '@/src/hooks/useProjectNumberProposal';
import { useCompanies } from '@/src/hooks/useCompanies';
import {
  formatMoneyInputValue,
  moneyInputErrorKind,
  numberSymbols,
  parseMoneyInput,
  parseMoneyInputAtScale,
} from '@/src/lib/format';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import { CONTRACT_TAX_REQUIRED_HINT } from '@/src/lib/taxTreatment';
import { useOrgTaxDefault, useTaxTreatmentPreselect } from '@/src/hooks/useOrgTaxDefault';
import { useTaxTreatmentOptions } from '@/src/hooks/useTaxTreatmentOptions';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import { AWARD_TYPES, BIDDING_ENTITIES, CLASSIFICATION_MAX_LENGTH, classificationValueLabel, classificationValueOptions } from '@/src/lib/projectClassification';
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

/** Pre-filled values when editing an existing project header. */
export interface ProjectFormInitial extends ProjectClassification {
  id: string;
  name: string;
  short_name?: string | null;
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
  serviceLine: string;
  sector: string;
  location: string;
  awardType: string;
  biddingEntity: string;
  name: string;
  shortName: string;
  code: string;
  pmoProjectNumber: string;
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
    if (v.location.trim().length > CLASSIFICATION_MAX_LENGTH) {
      errors.location = t('projectClassification.tooLong', 'Use {{max}} characters or fewer.', { max: CLASSIFICATION_MAX_LENGTH });
    }
    return errors;
  };

export interface ProjectFormModalProps {
  /** Omit (or 'create') for a new project; 'editHeader' to edit an existing project. */
  mode?: 'create' | 'editHeader';
  /** The project being edited (required for mode="editHeader"). */
  initial?: ProjectFormInitial;
  /** Optional client preselection for the create flow. */
  initialClientId?: string;
  onClose: () => void;
  /** Create handler — receives the full CreateProjectInput (mode="create"). */
  onSubmit?: (input: CreateProjectInput) => Promise<void>;
  /** Edit-header handler — receives id + ProjectHeaderInput (mode="editHeader"). */
  onSave?: (id: string, input: ProjectHeaderInput) => Promise<void>;
  onError: (err: unknown) => void;
  /**
   * `page` renders the same form inline as a full page (the one-step create at `/projects/new`)
   * instead of a dialog; `onClose` is then the Cancel action and the host owns the unsaved guard.
   */
  variant?: 'modal' | 'page';
  /** Reports whether the form holds unsaved entries (host guards leaving). */
  onDirtyChange?: (dirty: boolean) => void;
  /** Reports the selected origination stage to the Projects page scope line. */
  onOriginationStageChange?: (stage: ProjectStatus) => void;
}

const ProjectFormModal: React.FC<ProjectFormModalProps> = ({
  mode = 'create',
  initial,
  initialClientId,
  onClose,
  onSubmit,
  onSave,
  onError,
  variant = 'modal',
  onDirtyChange,
  onOriginationStageChange,
}) => {
  const classificationOptions = useProjectClassificationOptions();
  const isEdit = mode === 'editHeader';
  const { t } = useTranslation(['common', 'projects']);
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
      serviceLine: initial?.service_line ?? '',
      sector: initial?.sector ?? '',
      location: initial?.location ?? '',
      awardType: initial?.award_type ?? '',
      biddingEntity: initial?.bidding_entity ?? '',
      name: initial?.name ?? '',
      shortName: initial?.short_name ?? '',
      code: initial?.code ?? '',
      pmoProjectNumber: '',
      clientId: initial?.client_id ?? initialClientId ?? null,
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
    requiredFields: isEdit ? ['name', 'clientId'] : ['name', 'clientId', 'pmoProjectNumber'],
  });

  // Keep the selected label beside its id. Edit records may seed both; source-list
  // client filters seed the id and resolve its visible name from the loaded options.
  const [clientLabel, setClientLabel] = useState<string | null>(initial?.clientName ?? null);
  const numberProposal = useProjectNumberProposal(form.values.clientId, !isEdit);
  const appliedProposal = useRef<string | null>(null);
  const [numberConflict, setNumberConflict] = useState(false);
  const [shortNameConflict, setShortNameConflict] = useState(false);
  const [classificationOpen, setClassificationOpen] = useState(false);
  useEffect(() => {
    if (!isEdit && numberProposal.status === 'success' && numberProposal.number !== appliedProposal.current) {
      form.setValue('pmoProjectNumber', numberProposal.number);
      appliedProposal.current = numberProposal.number;
    }
  }, [form, isEdit, numberProposal]);
  const [pmLabel, setPmLabel] = useState<string | null>(initial?.pmName ?? null);
  const [endClientLabel, setEndClientLabel] = useState<string | null>(initial?.endClientName ?? null);

  const nameField = form.fieldProps('name');
  const shortNameField = form.fieldProps('shortName');
  const codeField = form.fieldProps('code');
  const pmoNumberField = form.fieldProps('pmoProjectNumber');
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
  const orgCurrency = useOrgCurrency();
  useTaxTreatmentPreselect(
    orgTaxDefault,
    form.values.taxTreatment,
    (v) => form.setValue('taxTreatment', v),
    !isEdit,
  );
  const taxFields = useStandaloneTaxFields(form.values.value, form.values.taxTreatment, form.values.taxAmount, (v) => form.setValue('taxAmount', v));
  const parsedTax = taxFields.facts;
  const taxIncomplete = taxRequired && parsedTax === null;
  const startField = form.fieldProps('startDate');
  const endField = form.fieldProps('endDate');

  const loadClients = async (): Promise<ComboboxOption[]> => {
    if (clientsError) throw new Error('client load failed');
    return clients.map((c) => ({
      value: c.id,
      label: c.name,
      sub: c.short_name ?? t('companies.type.client', 'Client'),
    }));
  };

  const loadManagers = async (): Promise<ComboboxOption[]> => {
    if (pmError) throw new Error('pm load failed');
    return managers.map((m) => ({
      value: m.id,
      label: m.full_name,
    }));
  };

  const loadEndCustomers = async (): Promise<ComboboxOption[]> => {
    if (endCustomersError) throw new Error('end customer load failed');
    return allCompanies.map((c) => ({
      value: c.id,
      label: c.name,
      sub: c.short_name ?? t(`companies.type.${c.type.toLowerCase()}`, c.type),
    }));
  };

  // The error summary anchors the name field (a stable id); the client error renders
  // inline on the Combobox (its trigger id is component-generated). Both fields still
  // show their own inline role="alert" message — the summary is the focus-management
  // affordance for the first focusable field with a known id.
  // F8 (AC-IXD-FORM-F8): the value (estimated contract) field can carry a FORMAT
  // error (non-blank but unparseable) — it is anchored here so a still-invalid
  // submit moves focus to it (the completeness gate cannot block a non-blank field).
  const shortNameDuplicate = t('projects:shortName.duplicate', 'Another project already uses this short name');
  const errorSummaryRef = useRef<HTMLDivElement | null>(null);
  const errorSummary = [
    form.errors.name ? { fieldId: nameField.id, message: form.errors.name } : null,
    form.errors.clientId ? { fieldId: 'project-client-company', message: form.errors.clientId } : null,
    form.errors.value ? { fieldId: valueField.id, message: form.errors.value } : null,
    form.errors.location ? { fieldId: 'project-classification-location', message: form.errors.location } : null,
    shortNameConflict ? { fieldId: shortNameField.id, message: shortNameDuplicate } : null,
    numberConflict ? { fieldId: pmoNumberField.id, message: t('projectForm.projectNumber.duplicate', 'That PMO Project Number is already in use. Choose another number.') } : null,
  ].filter((x): x is { fieldId: string; message: string } => x != null);
  useEffect(() => {
    if (form.hasAttemptedSubmit && form.errors.location) setClassificationOpen(true);
  }, [form.hasAttemptedSubmit, form.errors.location]);
  const firstErrorMessage = errorSummary[0]?.message;
  useEffect(() => {
    if (!form.hasAttemptedSubmit || errorSummary.length === 0) return;
    errorSummaryRef.current?.focus();
    errorSummaryRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  }, [form.hasAttemptedSubmit, errorSummary.length, firstErrorMessage]);

  // Typed entries only: the org tax default and the proposed project number are seeded, not entered,
  // so a pristine page must not count as dirty (it would ask before leaving an empty form).
  const v = form.values;
  const hasEntries = v.status !== 'Leads' || [
    v.name, v.shortName, v.code, v.clientId, v.endClientId, v.pmId, v.value, v.startDate, v.endDate,
    v.serviceLine, v.sector, v.location, v.awardType, v.biddingEntity,
  ].some(Boolean);
  useEffect(() => {
    onDirtyChange?.(hasEntries);
  }, [hasEntries, onDirtyChange]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (values) => {
      try {
        const classification = {
          service_line: values.serviceLine.trim() || null,
          sector: values.sector.trim() || null,
          location: values.location.trim() || null,
          award_type: values.awardType || null,
          bidding_entity: values.biddingEntity || null,
        };
        if (isEdit && initial && onSave) {
          const input: ProjectHeaderInput = {
            ...classification,
            name: values.name.trim(),
            short_name: values.shortName.trim() || null,
            code: values.code.trim() || null,
            client_id: values.clientId,
            end_client_id: values.endClientId,
            project_manager_id: values.pmId,
            start_date: values.startDate || null,
            end_date: values.endDate || null,
          };
          await onSave(initial.id, input);
        } else if (onSubmit) {
          if (numberProposal.status !== 'success' || !values.pmoProjectNumber.trim()) return;
          const base = {
            ...classification,
            name: values.name.trim(),
            short_name: values.shortName.trim() || null,
            code: values.code.trim() || null,
            pmo_project_number: values.pmoProjectNumber.trim(),
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
            const tax = taxFields.facts;
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
              tax_rate: tax.taxRate, tax_base_numerator: tax.taxBaseNumerator, tax_base_denominator: tax.taxBaseDenominator,
            };
          } else {
            input = { ...base, contract_value: 0 };
          }
          await onSubmit(input);
        }
      } catch (err) {
        const failure = err as { code?: string; message?: string };
        if (failure.code === '23505' && failure.message?.includes('projects_org_short_name_uidx')) {
          setShortNameConflict(true);
        } else if (failure.code === '23505' && (!failure.message || failure.message.includes('pmo_project_number'))) {
          setNumberConflict(true);
        }
        onError(err);
      }
    });
  };

  const nameControl = <TextField id={nameField.id} label={t('projectForm.name.label', 'Project name')} required
    value={nameField.value} onChange={nameField.onChange} onBlur={nameField.onBlur} error={nameField.error}
    placeholder={t('projectForm.name.placeholder', 'e.g. Harbor civil works')}
    fullWidth={variant !== 'page' || isEdit} />;
  const shortNameControl = <TextField id={shortNameField.id} label={t('projects:shortName.label', 'Short name (optional)')}
    value={shortNameField.value} onChange={(value) => { shortNameField.onChange(value); setShortNameConflict(false); }}
    onBlur={shortNameField.onBlur} error={shortNameConflict ? shortNameDuplicate : undefined}
    helper={t('projects:shortName.hint', 'Shown in lists. Contract name is unchanged.')} />;
  const selectedClient = clients.find((company) => company.id === form.values.clientId);
  const selectedClientLabel = clientLabel ?? (selectedClient ? selectedClient.name : null);
  const clientControl = <Combobox id="project-client-company" label={t('projectForm.client.label', 'Client company')} required
    value={form.values.clientId}
    selectedOption={form.values.clientId && selectedClientLabel ? { value: form.values.clientId, label: selectedClientLabel } : null}
    onChange={(v, opt) => {
      if (form.values.clientId !== v) { form.setValue('pmoProjectNumber', ''); appliedProposal.current = null; setNumberConflict(false); }
      form.setValue('clientId', v); setClientLabel(opt.label);
    }}
    loadOptions={loadClients} placeholder={t('projectForm.client.placeholder', 'Select a company…')}
    searchPlaceholder={t('projectForm.client.search', 'Search companies…')} noun={t('projectForm.client.noun', 'company')}
    error={form.errors.clientId} />;
  const endCustomerControl = <Combobox label={t('projectForm.endCustomer.label', 'End customer')} value={form.values.endClientId}
    selectedOption={form.values.endClientId && endClientLabel ? { value: form.values.endClientId, label: endClientLabel } : null}
    onChange={(v, opt) => { form.setValue('endClientId', v); setEndClientLabel(opt.label); }}
    onClear={() => { form.setValue('endClientId', null); setEndClientLabel(null); }} clearable loadOptions={loadEndCustomers}
    placeholder={t('projectForm.endCustomer.placeholder', 'Select a company…')}
    searchPlaceholder={t('projectForm.endCustomer.search', 'Search companies…')} noun={t('projectForm.endCustomer.noun', 'company')} />;
  const codeControl = <TextField id={codeField.id} label={t('projectForm.clientCode.label', 'Client Project Code')}
    value={codeField.value} onChange={codeField.onChange} onBlur={codeField.onBlur}
    helper={t('projects:create.clientCodeHelper', 'Optional code used by your organization.')} mono />;
  const numberProposalHelper = numberProposal.status === 'idle'
    ? t('projects:create.numberPrerequisite', 'Select a client to propose a PMO Project Number.')
    : numberProposal.status === 'loading'
      ? <span role="status" aria-live="polite">{t('projectForm.projectNumber.loading', 'Proposing a PMO Project Number…')}</span>
      : numberProposal.status === 'success'
        ? t('projectForm.projectNumber.helper', 'PMO assigns this identifier. You can edit it before creating the project.')
        : undefined;
  const pmoNumberControl = !isEdit ? <TextField id={pmoNumberField.id} label={t('projectForm.projectNumber.label', 'PMO Project Number')}
    required value={pmoNumberField.value} onChange={(value) => { pmoNumberField.onChange(value); setNumberConflict(false); }} onBlur={pmoNumberField.onBlur}
    error={numberConflict ? t('projectForm.projectNumber.duplicate', 'That PMO Project Number is already in use. Choose another number.')
      : numberProposal.status === 'error'
        ? numberProposal.error.includes('client_segment_required')
          ? t('projectForm.projectNumber.segmentRequired', 'The selected company needs a Client number segment before a PMO Project Number can be proposed.')
          : t('projectForm.projectNumber.proposalError', 'A PMO Project Number could not be proposed. Change the client and reselect it to try again.')
        : undefined}
    disabled={numberProposal.status !== 'success'} helper={numberProposalHelper} mono /> : null;
  const stageControl = !isEdit ? <SelectField id={statusField.id} label={t('projectForm.stage.label', 'Origination stage')}
    value={statusField.value} onChange={(value) => { const nextStage = value as ProjectStatus; statusField.onChange(nextStage); onOriginationStageChange?.(nextStage); }}
    options={originationOptions} helper={variant === 'page' ? undefined : t('projectForm.stage.helper', 'On-hand is reached only by winning a project in the pipeline, never created directly.')} /> : null;
  const requiredIdentityGrid = variant === 'page' && !isEdit ? (
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
      <div className="min-w-0 sm:col-span-3">{nameControl}</div>
      {clientControl}
      {pmoNumberControl}
      {stageControl}
    </div>
  ) : null;
  const optionalIdentityGrid = variant === 'page' && !isEdit ? (
    <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="min-w-0 sm:col-span-2">{shortNameControl}</div>
      {codeControl}{endCustomerControl}
    </div>
  ) : null;
  const legacyIdentityGrid = variant !== 'page' || isEdit ? (
    <FormGrid>{nameControl}{shortNameControl}{clientControl}{endCustomerControl}{isEdit ? codeControl : <>{pmoNumberControl}{codeControl}{stageControl}</>}</FormGrid>
  ) : null;

  const classificationValues = [
    form.values.serviceLine,
    form.values.sector,
    form.values.awardType ? classificationValueLabel(t, form.values.awardType) : '',
    form.values.biddingEntity ? classificationValueLabel(t, form.values.biddingEntity) : '',
    form.values.location.trim().length <= CLASSIFICATION_MAX_LENGTH ? form.values.location : '',
  ].filter(Boolean);
  const classificationSummary = classificationValues.length > 0
    ? t('projects:create.classificationCount', '{{count}} fields set', { count: classificationValues.length })
    : t('projects:create.classificationEmpty', 'Optional project context');
  const fields = (
    <>
      <FormSection legend={t('projectForm.section.project', 'Project')} className="[&>legend]:text-xl [&>legend]:font-bold">
        {requiredIdentityGrid}
        {optionalIdentityGrid}
        {legacyIdentityGrid}
      </FormSection>

      <FormSection legend={t('projects:create.section.ownershipSchedule', 'Ownership & schedule')} className="[&>legend]:text-xl [&>legend]:font-bold">
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="min-w-0 sm:col-span-2"><Combobox
            label={t('projectForm.pm.label', 'Project manager')}
            value={form.values.pmId}
            selectedOption={
              form.values.pmId && pmLabel
                ? { value: form.values.pmId, label: pmLabel }
                : null
            }
            onChange={(v, opt) => {
              form.setValue('pmId', v);
              setPmLabel(opt.label);
            }}
            loadOptions={loadManagers}
            placeholder={t('projectForm.pm.placeholder', 'Assign a PM…')}
            noun={t('projectForm.pm.noun', 'manager')}
          /></div>
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
        </div>
      </FormSection>

      {!isEdit && <FormSection legend={t('projects:create.section.estimateTaxCurrency', 'Estimate & tax · {{currency}}', { currency: orgCurrency })} className="[&>legend]:text-xl [&>legend]:font-bold">
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="min-w-0 sm:col-span-2">
          <NumberField fullWidth
            id={valueField.id}
            label={t('projectForm.estimatedValue', 'Estimated value')}
            value={valueField.value}
            onChange={valueField.onChange}
            onBlur={valueField.onBlur}
            error={valueField.error}
            localeAware
            placeholder={t('projects:create.estimateUnset', 'Not entered')}
            helper={t('projectForm.value.helper', 'Estimate, pre-win. Editable by Admin, Executive, and PM.')}
          />
          </div>
          {/* A stated non-zero value requires its tax basis; serialization of an unset estimate remains unchanged. */}
          {taxRequired && (
            <>
              <div className="min-w-0 sm:col-span-2"><TaxRateFields fields={taxFields} /></div>
              <SelectField
                id={taxTreatmentField.id}
                label={t('projectDetail.header.taxTreatment', 'Tax treatment')}
                required
                value={taxTreatmentField.value}
                onChange={taxTreatmentField.onChange}
                placeholder={taxOptions.placeholder}
                helper={t('projects:create.taxTreatmentHelper', 'Inclusive keeps tax in the amount. Exclusive adds tax on top.')}
                options={taxOptions.options.map((option) => ({
                  ...option,
                  label: option.value === 'inclusive'
                    ? t('projects:create.taxInclusiveShort', 'Inclusive')
                    : t('projects:create.taxExclusiveShort', 'Exclusive'),
                }))}
                data-testid="project-tax-treatment"
              />
              <NumberField
                id={taxAmountField.id}
                label={t('projectDetail.header.taxAmount', 'Tax amount')}
                required
                value={taxAmountField.value}
                readOnly={taxFields.hasRate}
                onChange={taxAmountField.onChange}
                onBlur={taxAmountField.onBlur}
                localeAware
                placeholder="0"
                data-testid="project-tax-amount"
              />
              {taxIncomplete && (
                <p data-testid="project-tax-required-hint" className="col-span-full text-sm text-muted-foreground">
                  {t('projectForm.taxRequiredHint', CONTRACT_TAX_REQUIRED_HINT)}
                </p>
              )}
            </>
          )}
        </div>
      </FormSection>}

      <details open={classificationOpen} onToggle={(event) => setClassificationOpen(event.currentTarget.open)} className="group border-t border-border pt-3">
        <summary aria-expanded={classificationOpen} aria-controls="project-classification-fields" className="touch-target flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-2 rounded-sm font-semibold text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
          <span>{t('projectClassification.title', 'Classification')}</span>
          {!classificationOpen && <span className="min-w-0 break-words text-sm font-normal text-muted-foreground">
            {classificationSummary || t('projects:create.classificationEmpty', 'Optional project context')}
          </span>}
          <span className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-primary-text">
            {classificationOpen ? t('projects:create.classificationHide', 'Hide classification') : t('projects:create.classificationShow', 'Show classification')}
            <Icon name="chev" className={classificationOpen ? '-rotate-90' : 'rotate-90'} />
          </span>
        </summary>
        <div id="project-classification-fields">
        <FormSection className="mt-3 [&>legend]:text-xl [&>legend]:font-bold">
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
          {(['serviceLine', 'sector'] as const).map((key) => {
            const configured = key === 'serviceLine' ? classificationOptions.data?.serviceLines : classificationOptions.data?.sectors;
            const current = form.values[key];
            const options = [...new Set([...(configured ?? []), ...(current ? [current] : [])])];
            return <SelectField key={key} id={`project-classification-${key}`}
              label={key === 'serviceLine' ? t('projectClassification.serviceLine', 'Service line') : t('projectClassification.sector', 'Sector')}
              value={current} onChange={(value) => form.setValue(key, value)}
              disabled={!classificationOptions.data}
              options={[{ value: '', label: t('projectClassification.notSet', 'Not set') }, ...options.map((value) => ({ value, label: value }))]}
              helper={classificationOptions.isError ? t('projectClassification.unavailable', 'Options could not be loaded. Reopen this form to retry.') : undefined} />;
          })}
          <SelectField id="project-classification-award" label={t('projectClassification.awardType', 'Award type')}
            value={form.values.awardType} onChange={(value) => form.setValue('awardType', value)}
            options={[{ value: '', label: t('projectClassification.notSet', 'Not set') }, ...classificationValueOptions(t, AWARD_TYPES)]} />
          <SelectField id="project-classification-bidding" label={t('projectClassification.biddingEntity', 'Bidding entity')}
            value={form.values.biddingEntity} onChange={(value) => form.setValue('biddingEntity', value)}
            options={[{ value: '', label: t('projectClassification.notSet', 'Not set') }, ...classificationValueOptions(t, BIDDING_ENTITIES)]} />
          <div className="min-w-0 sm:col-span-2"><TextField {...form.fieldProps('location')} id="project-classification-location" label={t('projectClassification.location', 'Location')} fullWidth /></div>
        </div>
        </FormSection>
        </div>
      </details>
    </>
  );

  const submitDisabled = !form.isComplete || taxIncomplete || (!isEdit && numberProposal.status !== 'success');
  const submitLabel = isEdit ? t('projectForm.submit.edit', 'Save project') : t('projectForm.submit.create', 'Create project');
  const disabledReasons = !isEdit ? [
    !form.values.name.trim() ? { id: nameField.id, label: t('projects:create.disabledName', 'Add a project name.') } : null,
    !form.values.clientId ? { id: 'project-client-company', label: t('projects:create.disabledClient', 'Select a client company.') } : null,
    numberProposal.status !== 'success' || !form.values.pmoProjectNumber.trim()
      ? { id: numberProposal.status === 'success' ? pmoNumberField.id : 'project-client-company', label: numberProposal.status === 'loading'
          ? t('projects:create.disabledProposalLoading', 'Wait for the PMO Project Number proposal.')
          : numberProposal.status === 'error'
            ? t('projects:create.disabledProposalError', 'Change or reselect the client to retry the number proposal.')
            : t('projects:create.disabledProposal', 'Wait for a PMO Project Number proposal.') }
      : null,
    taxIncomplete ? { id: taxTreatmentField.id, label: t('projects:create.disabledTax', 'Complete the required tax details.') } : null,
  ].filter((reason): reason is { id: string; label: string } => Boolean(reason)) : [];
  const showDisabledReasons = variant === 'page' && !isEdit && submitDisabled;
  const disabledReasonId = 'project-create-disabled-reason';

  if (variant === 'page') {
    return (
      <form onSubmit={handleSubmit} className="w-full min-w-0">
        <div className="min-w-0">
          {errorSummary.length > 0 && form.hasAttemptedSubmit && (
            <div ref={errorSummaryRef} role="alert" tabIndex={-1} className="mb-4 text-sm text-destructive-text">
              {errorSummary.map((item) => (
                <a key={item.message} href={`#${item.fieldId}`} className="block py-1 hover:underline">{item.message}</a>
              ))}
            </div>
          )}
          {fields}
        </div>
        <div className="mt-3 border-t border-border bg-background py-3 min-[920px]:sticky min-[920px]:bottom-0">
          {showDisabledReasons && <div id={disabledReasonId} className="mb-3 min-w-0 text-sm text-muted-foreground" aria-live="polite">
            <p className="mb-1 font-semibold text-foreground">{t('projects:create.disabledIntro', 'To create this project, complete:')}</p>
            <ul className="list-inside list-disc space-y-0.5">
              {disabledReasons.map((reason) => <li key={`${reason.id}:${reason.label}`}><a className="inline-flex min-h-11 items-center rounded-sm underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" href={`#${reason.id}`}>{reason.label}</a></li>)}
            </ul>
          </div>}
          <FormActions
            submitLabel={submitLabel}
            cancelLabel={t('entityForm.cancel', 'Cancel')}
            onCancel={onClose}
            disabled={submitDisabled}
            loading={form.isSubmitting}
            submitDescribedBy={showDisabledReasons ? disabledReasonId : undefined}
            className="[@media(pointer:coarse)]:[&_button]:min-h-11"
          />
        </div>
      </form>
    );
  }

  return (
    <EntityFormModal
      open
      title={isEdit ? t('projectForm.title.edit', 'Edit project') : t('projectForm.title.create', 'New project')}
      subtitle={
        isEdit
          ? t('projectForm.subtitle.edit', 'Update the project header details')
          : t('projectForm.subtitle.create', 'Create a project')
      }
      submitLabel={submitLabel}
      onSubmit={handleSubmit}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitDisabled={submitDisabled}
      errorSummary={errorSummary.length ? errorSummary : undefined}
    >
      {fields}
    </EntityFormModal>
  );
};

export default ProjectFormModal;
