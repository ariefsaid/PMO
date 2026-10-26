import { companyDisplayName } from '@/src/lib/companyDisplayName';
import { TaxRateFields } from '@/src/components/ui/TaxRateFields';
import { useStandaloneTaxFields } from '@/src/hooks/useStandaloneTaxFields';
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Trans, useTranslation } from 'react-i18next';
import {
  RecordHeader,
  StatusPill,
  Button,
  NumberField,
  SelectField,
  ConfirmDialog,
  GateNotice,
  TaxBasisLabel,
  useToast,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useProjectMutations } from '@/src/hooks/useProjects';
import { useProjectVatEditability } from '@/src/hooks/useProjectVatEditability';
import { Checkbox } from '@/src/components/ui/Checkbox';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { projectVatRefusal } from '@/src/lib/projectVatRefusal';
import {
  currencySymbol,
  formatCurrency,
  formatDateOnly,
  formatMoneyInputValue,
  parseMoneyInputAtScale,
} from '@/src/lib/format';
import {
  TAX_TREATMENT_OPTIONS,
  TAX_TREATMENT_PLACEHOLDER,
  CONTRACT_TAX_REQUIRED_HINT,
} from '@/src/lib/taxTreatment';
import type { ProjectWithRefs, TaxTreatment } from '@/src/lib/db/projects';
import type { Role } from '@/src/auth/AuthContext';
import { LEGAL_PROJECT_TRANSITIONS, ON_HAND_STATUSES, projectStatusGroup } from '@/src/lib/db/projectTransitions';
import { pillVariantForProjectStatus, projectIconColor } from '../../components/projects';
import ProjectStatusControl from '../../components/ProjectStatusControl';
import { SALES_COLUMNS } from '../../components/salesPipeline';
import { useProjectStatusLabel, useSalesStageLabel } from '@/src/hooks/useProjectStatusLabel';

/** Finance authority affects contract-value writes; it does not change the record facts shown. */
// eslint-disable-next-line react-refresh/only-export-components -- pure predicate co-located with its component; HMR-only lint concern
export function hasFinanceView(role: Role | null): boolean {
  if (!role) return false;
  return (['Admin', 'Executive', 'Finance', 'Project Manager'] as Role[]).includes(role);
}

/** The staged contract-value change held by the SoD audit confirm — value AND the basis it is on. */
interface PendingContractValue {
  value: number;
  taxTreatment: TaxTreatment;
  taxAmount: number;
  taxRate?: number | null;
  taxBaseNumerator?: number;
  taxBaseDenominator?: number;
  subjectToVat?: boolean;
}

export interface ProjectDetailHeaderProps {
  project: ProjectWithRefs;
  onEditProject?: () => void;
  isOverview?: boolean;
  showPipelinePrimaryAction?: boolean;
  primaryAction?: React.ReactNode;
}

/**
 * Detail-page identity and action header. Project money facts live in Overview's money position;
 * this component keeps record identity and the permitted contract-value editor.
 *
 * CRUD affordances (crud-components §9.1, rbac-visibility §B2), all gated on the REAL
 * JWT role (ADR-0016); RLS/RPC remain the enforcement authority:
 *  • Header **Edit** (Admin·Exec·PM) → the edit-header ProjectFormModal.
 *  • Header **Archive** (Admin·Exec) → a destructive confirm → archived_at stamp.
 *  • **contract_value SoD** (ADR-0019): pre-win a delivery role may set the value freely;
 *    on a WON/on-hand project only Exec/Finance/Admin may, via the scoped RPC behind an
 *    audit confirm that NAMES the segregation of duties. A delivery role that cannot edit
 *    a won value sees the Overview money group’s static “Read-only” lock.
 */
const ProjectDetailHeader: React.FC<ProjectDetailHeaderProps> = ({
  project,
  onEditProject,
  isOverview = false,
  showPipelinePrimaryAction = false,
  primaryAction,
}) => {
  const { t } = useTranslation();
  const projectStatusLabel = useProjectStatusLabel();
  const salesStageLabel = useSalesStageLabel();
  const salesStage = SALES_COLUMNS.find((column) => !column.terminal && column.testId !== 'stage-Won' && column.statuses.includes(project.status));
  const may = usePermission();
  const { realRole } = useEffectiveRole();
  const { toast } = useToast();
  const { archive, remove, setContractValue } = useProjectMutations();
  const navigate = useNavigate();

  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [moreActionsOpen, setMoreActionsOpen] = useState(false);
  // contract_value inline-edit state.
  const [valueEditing, setValueEditing] = useState(false);
  const [valueDraft, setValueDraft] = useState('');
  // #513: the basis the new value is stated on. ⛔ Both start EMPTY on every open and are never
  // seeded — not from the stored row either. 0197's backfill wrote 'exclusive' onto every existing
  // project (arithmetically inert, but nobody chose it), so pre-filling from the row would re-assert
  // a marker no human ever stated — the exact silently-wrong-marker defect this issue removes. The
  // RPC demands the basis on every set for the same reason: restating the value restates the basis.
  const [taxTreatmentDraft, setTaxTreatmentDraft] = useState('');
  const [taxAmountDraft, setTaxAmountDraft] = useState('');
  // VAT eligibility is advisory UX only; the setter and database trigger remain authoritative.
  const [vatDraft, setVatDraft] = useState(true);
  const vatCheck = useProjectVatEditability(project.id);
  const vatLocked = vatCheck.isPending || vatCheck.isFetching || vatCheck.isError || vatCheck.data?.eligible !== true;
  const taxFields = useStandaloneTaxFields(valueDraft, taxTreatmentDraft, taxAmountDraft, setTaxAmountDraft, project.tax_rate == null ? '' : formatMoneyInputValue(project.tax_rate), `${project.tax_base_numerator ?? 1}/${project.tax_base_denominator ?? 1}`);
  // The audit-confirm holds the pending new value + its basis until the user confirms the SoD action.
  const [pendingValue, setPendingValue] = useState<PendingContractValue | null>(null);

  const contract = project.contract_value ?? 0;
  const status = project.status as string;
  const isOnHand = ON_HAND_STATUSES.includes(status);
  const group = projectStatusGroup(project.status as never);
  const isPipelineRecord = group === 'pipeline' || group === 'lost';
  const isDelivery = group === 'onHand' || group === 'internal';
  const isFinanceForward = hasFinanceView(realRole);

  const canEdit = may('edit', 'project');
  const canArchive = may('archive', 'project');
  const canDelete = may('delete', 'project'); // Admin-only (rbac-visibility §B2/§K).
  const canTransition = may('transition', 'project') && (LEGAL_PROJECT_TRANSITIONS[status] ?? []).length > 0;
  const statusIsPrimary = isOverview && canTransition && (realRole === 'Finance' || realRole === 'Executive') && !showPipelinePrimaryAction;
  // The PipelineLens owns pipeline transitions for delivery writers. Keep the existing status
  // control available to roles that can transition but cannot use the pipeline action cluster.
  const canShowHeaderTransition = canTransition && (!isPipelineRecord || !canEdit);
  const canEditValue = may('editContractValue', 'project', { record: { status } });
  const canSetVat = may('setVatFlag', 'project');

  const customerName = project.client ? companyDisplayName(project.client) : null;
  const startDate = project.start_date ? formatDateOnly(project.start_date) : null;
  const endDate = project.end_date ? formatDateOnly(project.end_date) : null;
  const dateScope = startDate && endDate
    ? t('projectDetail.header.scope.dateRange', '{{start}} – {{end}}', { start: startDate, end: endDate })
    : startDate
      ? t('projectDetail.header.scope.startDate', 'Starts {{date}}', { date: startDate })
      : endDate
        ? t('projectDetail.header.scope.targetEnd', 'Target end {{date}}', { date: endDate })
        : null;
  const meta = (
    <div role="group" aria-label={t('projectDetail.header.scope.ariaLabel', 'Project scope')} className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {customerName && (project.client_id
        ? <Link to={`/companies/${project.client_id}`} className="touch-target inline-flex min-h-11 items-center font-medium text-primary-text underline-offset-4 hover:underline">{customerName}</Link>
        : <span className="font-medium text-foreground">{customerName}</span>)}
      <span>{t('projectDetail.header.scope.projectManager', 'PM: {{name}}', {
        name: project.pm?.full_name ?? t('projectDetail.header.scope.unassigned', 'Unassigned'),
      })}</span>
      {dateScope && <span>{dateScope}</span>}
    </div>
  );

  const beginValueEdit = () => {
    // Seed the editor with the formatted figure ("5,000,000"), not the raw number. The tax fields
    // are deliberately NOT seeded — see the state declaration.
    setValueDraft(project.contract_value == null ? '' : formatMoneyInputValue(project.contract_value));
    setTaxTreatmentDraft('');
    setTaxAmountDraft('');
    setVatDraft(project.subject_to_vat ?? true);
    void vatCheck.refetch();
    taxFields.setRateRaw(project.tax_rate == null ? '' : formatMoneyInputValue(project.tax_rate));
    taxFields.setBaseRaw(`${project.tax_base_numerator ?? 1}/${project.tax_base_denominator ?? 1}`);
    setValueEditing(true);
  };

  const cancelValueEdit = () => {
    setValueEditing(false);
    setValueDraft('');
    setTaxTreatmentDraft('');
    setTaxAmountDraft('');
  };

  // #513: the ONE predicate. `stagedValue` is null exactly when the editor is not submittable —
  // no parsable value, or a value with no stated basis — and it drives BOTH the disabled Save and
  // the guard inside `onValueSave`, so the button state and the write guard cannot disagree.
  // The same locale-aware scale-2 parse drives eligibility and the eventual RPC payload.
  const parsedValue = parseMoneyInputAtScale(valueDraft, 2);
  const parsedTax = taxFields.facts;
  const valueDraftError = valueDraft.trim() && (parsedValue === null || parsedValue < 0)
    ? t('projectDetail.header.invalidContractValue', 'Enter a valid non-negative amount with no more than 2 decimal places.')
    : undefined;
  const stagedValue: PendingContractValue | null =
    parsedValue !== null && parsedValue >= 0 && parsedTax !== null
      ? { value: parsedValue, ...parsedTax, ...(canSetVat && !vatLocked && vatDraft !== (project.subject_to_vat ?? true) ? { subjectToVat: vatDraft } : {}) }
      : null;

  // Save the value. On a WON/on-hand project this is a segregation-of-duties action →
  // stage it for the audit confirm. Pre-win, commit straight away (no SoD confirm).
  const onValueSave = () => {
    if (!stagedValue) return;
    if (isOnHand) {
      setPendingValue(stagedValue);
    } else {
      void commitValue(stagedValue);
    }
  };

  const commitValue = async (next: PendingContractValue) => {
    try {
      await setContractValue.mutateAsync({ id: project.id, ...next });
      toast(
        t('projectDetail.header.toast.contractValueUpdated', 'Contract value updated'),
        formatCurrency(next.value, project.currency),
        'success',
      );
      setValueEditing(false);
      setValueDraft('');
      setTaxTreatmentDraft('');
      setTaxAmountDraft('');
      setPendingValue(null);
    } catch (err) {
      const refusal = projectVatRefusal(err);
      if (refusal === 'live-invoice' || refusal === 'command-pending' || refusal === 'context-changed') {
        toast(
          t('projectDetail.header.vatStaleSave', 'PPN was not changed. The project\'s invoice state changed; refresh and try again when all invoices are cancelled and commands have settled.'),
          '',
          'warning',
        );
        void vatCheck.refetch();
      } else {
        const { headline, detail } = classifyMutationError(err);
        toast(headline, detail, 'warning');
      }
      setPendingValue(null);
    }
  };

  const onArchiveConfirm = async () => {
    try {
      await archive.mutateAsync(project.id);
      toast(t('projectDetail.header.toast.archived', 'Project archived'), project.name, 'success');
      setArchiveOpen(false);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  // Hard delete (Admin-only). On success the record no longer exists → route back to
  // the index. On a referenced-project block (23503) the classified toast points the
  // user at Archive instead; the confirm itself was left open is closed regardless.
  const onDeleteConfirm = async () => {
    try {
      await remove.mutateAsync(project.id);
      toast(t('projectDetail.header.toast.deleted', 'Project deleted'), project.name, 'success');
      setDeleteOpen(false);
      navigate('/projects');
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
      setDeleteOpen(false);
    }
  };

  const hasMoreActions = (canShowHeaderTransition && !statusIsPrimary) || canEdit || canArchive || canDelete || (isDelivery && canEditValue && isFinanceForward);
  const moreActions = hasMoreActions ? (
    <details className="relative" onToggle={(event) => setMoreActionsOpen(event.currentTarget.open)}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-md border border-border px-3 text-sm font-medium text-foreground hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        {t('moreActions', 'More actions')}
      </summary>
      <div hidden={!moreActionsOpen} className={`absolute right-0 z-30 mt-1 min-w-48 flex-col gap-1 rounded-md border border-border bg-popover p-2 shadow-md ${moreActionsOpen ? 'flex' : 'hidden'}`}>
        {canShowHeaderTransition && !statusIsPrimary && moreActionsOpen && <ProjectStatusControl project={project} />}
        {isDelivery && canEditValue && isFinanceForward && !valueEditing && (
          <Button variant="outline" size="sm" className="justify-start" onClick={beginValueEdit}>
            {t('projectDetail.header.editContractValue', 'Edit contract value')}
          </Button>
        )}
        {canEdit && (
          <Button variant="outline" size="sm" className="justify-start" onClick={onEditProject}>
            {t('projectDetail.header.action.edit', 'Edit')}
          </Button>
        )}
        {canArchive && (
          <Button variant="ghost" size="sm" className="justify-start" onClick={() => setArchiveOpen(true)}>
            {t('projectDetail.header.action.archive', 'Archive')}
          </Button>
        )}
        {canDelete && (
          <Button
            variant="ghost"
            size="sm"
            className="justify-start text-destructive-text hover:bg-destructive/10 hover:text-destructive-text"
            onClick={() => setDeleteOpen(true)}
          >
            {t('projectDetail.header.action.delete', 'Delete')}
          </Button>
        )}
      </div>
    </details>
  ) : null;
  const actions = primaryAction || statusIsPrimary || moreActions ? (
    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap">
      {primaryAction}
      {statusIsPrimary && <ProjectStatusControl project={project} triggerVariant="primary" />}
      {moreActions}
    </div>
  ) : undefined;

  /** Contract-value editor fields and SoD context appear only during an authorized edit. */
  const sodRow = isDelivery ? (
    <div
      data-testid="contract-value-sod"
      className={`flex flex-wrap items-center gap-3 ${valueEditing ? 'py-1' : ''}`}
    >
      {valueEditing && isFinanceForward ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-[180px]">
            <NumberField
              label={t('projectDetail.header.contractValue', 'Contract value')}
              prefix={currencySymbol(project.currency)}
              value={valueDraft}
              onChange={setValueDraft}
              error={valueDraftError}
              localeAware
            />
          </div>
          {/* #513: the contract value's tax basis — BOTH required, and the treatment has no
              pre-selected option. Without it the work-order drawdown compares this ceiling against
              order values on an unknown basis and UNDER-detects over-commitment (migration 0197).
              Options/placeholder/parse are single-sourced in src/lib/taxTreatment.ts so this form
              and the vendor-invoice forms cannot drift. */}
          <div className="w-[240px]">
            <SelectField
              label={t('projectDetail.header.taxTreatment', 'Tax treatment')}
              value={taxTreatmentDraft}
              onChange={setTaxTreatmentDraft}
              placeholder={TAX_TREATMENT_PLACEHOLDER}
              options={TAX_TREATMENT_OPTIONS}
              data-testid="contract-tax-treatment"
            />
          </div>
          <TaxRateFields fields={taxFields} />
          {canSetVat && (
            <div className="basis-full" data-testid="contract-vat-flag">
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={vatLocked ? (project.subject_to_vat ?? true) : vatDraft}
                  onChange={setVatDraft}
                  disabled={vatLocked}
                  label={t('projectDetail.header.subjectToVat', 'Subject to VAT (PPN)')}
                  labelledBy="contract-vat-flag-label"
                  describedBy="contract-vat-flag-hint"
                />
                <span
                  id="contract-vat-flag-label"
                  className={`text-sm text-foreground ${vatLocked ? '' : 'cursor-pointer'}`}
                  onClick={() => { if (!vatLocked) setVatDraft(!vatDraft); }}
                >
                  {t('projectDetail.header.subjectToVat', 'Subject to VAT (PPN)')}
                </span>
              </div>
              <p data-testid="contract-vat-flag-hint" className="text-sm text-muted-foreground">
                {vatCheck.isPending || vatCheck.isFetching
                  ? t('projectDetail.header.vatChecking', 'Checking whether PPN can be changed…')
                  : vatCheck.isError
                    ? t('projectDetail.header.vatUnavailable', 'PPN editability could not be checked. Retry the check.')
                    : !canSetVat
                      ? t('projectDetail.header.vatRoleReadOnly', 'Only Finance or Admin can change whether this project is subject to PPN.')
                      : vatCheck.data?.reason === 'vat-live-invoice'
                        ? t('projectDetail.header.vatLiveLocked', 'Locked while this project has an invoice that is not cancelled. Cancel every project invoice to change PPN.')
                        : vatCheck.data?.reason === 'vat-command-pending'
                          ? t('projectDetail.header.vatCommandLocked', 'Locked while an invoice command is in flight. Wait for it to settle; held commands need review.')
                          : vatCheck.data?.hasInvoices
                            ? t('projectDetail.header.vatCancelledHint', 'All project invoices are cancelled and no invoice command is in flight. You can change PPN for the next invoice; cancelled invoices keep their original tax.')
                            : t('projectDetail.header.vatEmptyHint', 'Editable until an invoice is raised. New invoices follow this setting.')}
              </p>
            </div>
          )}
          <div className="w-[160px]">
            <NumberField
              label={t('projectDetail.header.taxAmount', 'Tax amount')}
              prefix={currencySymbol(project.currency)}
              value={taxAmountDraft}
              readOnly={taxFields.hasRate}
              onChange={setTaxAmountDraft}
              localeAware
              data-testid="contract-tax-amount"
            />
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={onValueSave}
            disabled={stagedValue === null}
            loading={setContractValue.isPending}
          >
            {t('projectDetail.header.action.save', 'Save')}
          </Button>
          <Button variant="ghost" size="sm" onClick={cancelValueEdit}>
            {t('projectDetail.header.action.cancel', 'Cancel')}
          </Button>
          {stagedValue === null && (
            <p
              data-testid="contract-tax-required-hint"
              className="basis-full text-sm text-muted-foreground"
            >
              {CONTRACT_TAX_REQUIRED_HINT}
            </p>
          )}
        </div>
      ) : null}
      {isOnHand && canEditValue && isFinanceForward && valueEditing && (
        <span className="basis-full text-sm text-muted-foreground">
          {t(
            'projectDetail.header.sodEditableNote',
            'Changing the value on a won project is a segregation-of-duties action and is recorded.',
          )}
        </span>
      )}

    </div>
  ) : null;

  return (
    <>
      <RecordHeader
        icon={(project.name.trim().charAt(0) || '•').toUpperCase()}
        iconColor={projectIconColor()}
        name={<span>{project.name}</span>}
        status={
          <StatusPill variant={pillVariantForProjectStatus(status)} className={salesStage ? 'text-xs font-semibold' : undefined}>{salesStage ? salesStageLabel(salesStage) : projectStatusLabel(status)}</StatusPill>
        }
        // Phone keeps identity/status; the persistent Details rail below the
        // selected work already carries these codes, customer and PO facts.
        meta={meta}
        actions={actions}
        variant="drawer"
        sharedPageHeading
        className="mb-1 [&>div]:gap-2 [&_h1]:basis-full sm:[&_h1]:basis-auto [&_h1]:text-2xl [&_h1]:leading-tight [&_h1]:whitespace-normal [&_h1]:overflow-visible [&_h1]:text-clip [&_[data-page-scope]]:text-sm"
      />
      {isDelivery && valueEditing && <div className="mb-2">{sodRow}</div>}

      {/* Archive confirm (destructive tone — leaves the active list). */}
      <ConfirmDialog
        open={archiveOpen}
        tone="destructive"
        title={t('projectDetail.header.archiveConfirm.title', 'Archive {{name}}?', {
          name: project.name,
        })}
        description={t(
          'projectDetail.header.archiveConfirm.body',
          'It will be hidden from the default project list. Existing references stay intact. You can restore it later.',
        )}
        confirmLabel={t('projectDetail.header.archiveConfirm.confirm', 'Archive project')}
        loading={archive.isPending}
        onConfirm={onArchiveConfirm}
        onCancel={() => setArchiveOpen(false)}
      />

      {/* Hard-delete confirm (destructive tone, Admin-only). Names the irreversibility +
          recommends Archive as the recoverable alternative (error-recovery). */}
      <ConfirmDialog
        open={deleteOpen}
        tone="destructive"
        title={t('projectDetail.header.deleteConfirm.title', 'Delete {{name}}?', {
          name: project.name,
        })}
        description={t(
          'projectDetail.header.deleteConfirm.body',
          "This permanently removes the project and its budget, tasks, and documents. It can't be undone, and a project with procurement or logged time can't be deleted. Archive it instead if you only need to hide it.",
        )}
        confirmLabel={t('projectDetail.header.deleteConfirm.confirm', 'Delete project')}
        loading={remove.isPending}
        onConfirm={onDeleteConfirm}
        onCancel={() => setDeleteOpen(false)}
      />

      {/* contract_value SoD audit confirm (default tone) — names the SoD reason in the body. */}
      <ConfirmDialog
        open={pendingValue !== null}
        tone="default"
        title={t('projectDetail.header.contractValueConfirm.title', 'Change the contract value?')}
        description={
          pendingValue !== null ? (
            <>
              {/* ⚑ The note that used to sit here said <Trans> was impossible because the unit
                  runner never initialises i18next. The #526 review added an i18next instance to
                  test/setup.ts, so it has been possible since — the block outlived its cause
                  (#575). ONE sentence, never five gluable fragments: Indonesian reorders this and
                  fragments cannot be reordered.
                  ⚑ The basis word is a KEY, not the raw column value. `pendingValue.taxTreatment`
                  is the English enum 'inclusive'/'exclusive'; interpolating it raw drops an
                  untranslated English word into an Indonesian sentence. Two literal keys, never
                  one built from the value — a computed key reads as an orphan to the gate. */}
              {/* ⚑ The <5> slot is TaxBasisLabel ITSELF, not a copy of its ternary. That component
                  refuses to render an unknown treatment on purpose — 0197 pairs a NULL basis with
                  a zero contract value — and a ternary is not exhaustiveness-checked, so a third
                  state would put a confidently WRONG basis in a segregation-of-duties confirm. */}
              <Trans
                i18nKey="projectDetail.header.contractValueConfirm.body"
                defaults="You are changing the contract value of a won project from <1>{{from}}</1> to <3>{{to}}</3>, stated as <5></5> of <7>{{tax}}</7> tax."
                values={{
                  from: formatCurrency(contract, project.currency),
                  to: formatCurrency(pendingValue.value, project.currency),
                  tax: formatCurrency(pendingValue.taxAmount, project.currency),
                }}
                components={{
                  1: <b className="tabular text-foreground" />,
                  3: <b className="tabular text-foreground" />,
                  5: <TaxBasisLabel treatment={pendingValue.taxTreatment} taxRate={pendingValue.taxRate} taxBaseNumerator={pendingValue.taxBaseNumerator} taxBaseDenominator={pendingValue.taxBaseDenominator} className="text-sm text-foreground" />,
                  7: <b className="tabular text-foreground" />,
                }}
              />
              <GateNotice variant="blocked" className="mt-3">
                {t(
                  'projectDetail.header.contractValueConfirm.notice',
                  'Changing the contract value on a won project is a segregation of duties action and is recorded against your name, the date, and the previous value.',
                )}
              </GateNotice>
            </>
          ) : (
            ''
          )
        }
        confirmLabel={t('projectDetail.header.contractValueConfirm.confirm', 'Change and record')}
        loading={setContractValue.isPending}
        onConfirm={() => pendingValue !== null && void commitValue(pendingValue)}
        onCancel={() => setPendingValue(null)}
      />
    </>
  );
};

export default ProjectDetailHeader;
