import React, { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  RecordHeader,
  StatTiles,
  StatusPill,
  Button,
  Icon,
  NumberField,
  SelectField,
  ConfirmDialog,
  GateNotice,
  TaxBasisLabel,
  useToast,
  type StatTile,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useProjectMutations } from '@/src/hooks/useProjects';
import { useProjectBudget } from '@/src/hooks/useBudget';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatCurrency, formatDate, parseMoneyInput } from '@/src/lib/format';
import {
  TAX_TREATMENT_OPTIONS,
  TAX_TREATMENT_PLACEHOLDER,
  CONTRACT_TAX_REQUIRED_HINT,
  parseTaxFacts,
} from '@/src/lib/taxTreatment';
import type { ProjectWithRefs, TaxTreatment } from '@/src/lib/db/projects';
import type { Role } from '@/src/auth/AuthContext';
import { ON_HAND_STATUSES, projectStatusGroup } from '@/src/lib/db/projectTransitions';
import { pillVariantForProjectStatus, projectIconColor } from '../../components/projects';

/**
 * Finance-forward roles: Admin · Executive · Finance · Project Manager (the PM owns the P&L).
 * These roles see the finance StatTiles strip + contract-value SoD row in the header (unchanged).
 * Delivery-forward roles (Engineer and any future non-finance roles) have the strip moved to the
 * Overview "Financial summary" aside — FE-only reprioritization (OD-W5-C3-A).
 * Never use to hide data — only to reorder it. RLS stays the enforcement authority.
 */
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
}

export interface ProjectDetailHeaderProps {
  project: ProjectWithRefs;
  committedSpend?: number;
  onEditProject?: () => void;
}

/** Currency with a true minus glyph (U+2212) for negatives (number rigor). */
function signedCurrency(value: number, currency: string): string {
  if (value < 0) return `−${formatCurrency(Math.abs(value), currency)}`;
  return formatCurrency(value, currency);
}

/**
 * Group the digits of a partially-typed money value with thousands separators so
 * the inline editor reads "$5,000,000" rather than the raw "5000000" (polish #4).
 * Preserves a trailing decimal-in-progress (e.g. "1234." → "1,234.") and an empty
 * field, so it is safe to run on every keystroke of a controlled input.
 */
function formatThousands(raw: string): string {
  const cleaned = raw.replace(/[^0-9.]/g, '');
  if (cleaned === '') return '';
  const [intPart, ...rest] = cleaned.split('.');
  // eslint-disable-next-line no-restricted-syntax -- masked money INPUT, not display; owned by the #468 locale seam (excluded from the #477 sweep)
  const grouped = intPart ? Number(intPart).toLocaleString('en-US') : '';
  // Keep at most one decimal portion; "" intPart with a lone "." stays as ".".
  return rest.length ? `${grouped}.${rest.join('')}` : grouped;
}

/**
 * Detail-page header: PageHeader (icon + name + StatusPill + meta row) + a 5-stat
 * strip (Contract / Committed / Actual / On-hand margin / Spend %).
 *
 * CRUD affordances (crud-components §9.1, rbac-visibility §B2), all gated on the REAL
 * JWT role (ADR-0016); RLS/RPC remain the enforcement authority:
 *  • Header **Edit** (Admin·Exec·PM) → the edit-header ProjectFormModal.
 *  • Header **Archive** (Admin·Exec) → a destructive confirm → archived_at stamp.
 *  • **contract_value SoD** (ADR-0019): pre-win a delivery role may set the value freely;
 *    on a WON/on-hand project only Exec/Finance/Admin may, via the scoped RPC behind an
 *    audit confirm that NAMES the segregation of duties. A delivery role that cannot edit
 *    a won value sees a static "Read-only" lock (read-only-distinction), never a dead input.
 */
const ProjectDetailHeader: React.FC<ProjectDetailHeaderProps> = ({
  project,
  committedSpend,
  onEditProject,
}) => {
  const { t } = useTranslation();
  const may = usePermission();
  const { realRole } = useEffectiveRole();
  const { toast } = useToast();
  const { archive, remove, setContractValue } = useProjectMutations();
  const navigate = useNavigate();

  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
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
  // The audit-confirm holds the pending new value + its basis until the user confirms the SoD action.
  const [pendingValue, setPendingValue] = useState<PendingContractValue | null>(null);

  const contract = project.contract_value ?? 0;
  const committed = committedSpend ?? 0;
  // AC-MONEY-01: "Actual" is the committed-PO basis (Ordered..Paid), not the dead stored
  // projects.spent column which is never populated (0001_init_schema.sql:79 DEFERRED).
  // committed == actual (Ordered..Paid sum) — both reflect realized procurement spend.
  //
  // B-0.2 fix: Spend% must use the DERIVED budget (Σ Active-version line-items) not the
  // dead stored projects.budget column (which is never populated). Mirror OverviewTab.
  const { data: derivedBudget } = useProjectBudget(project.id);
  const activeBudget = derivedBudget ?? 0;
  const margin = contract - committed;
  const spendPct = activeBudget > 0 ? Math.round((committed / activeBudget) * 100) : 0;

  const status = project.status as string;
  const isOnHand = ON_HAND_STATUSES.includes(status);
  // Model B (ADR-0020): a pre-win (pipeline) / terminal (lost) deal has no contract yet, so the
  // delivery summary (StatTiles: Contract/Committed/Actual/margin/Spend) and the contract-value
  // SoD editor are mounted only for the DELIVERY lens (on-hand ∪ internal). Pre-win, the deal's
  // figures live in the PipelineLens (Value / Win probability / Weighted) instead.
  const group = projectStatusGroup(project.status as never);
  const isDelivery = group === 'onHand' || group === 'internal';

  // D15 (OD-W5-C3-A): delivery-forward roles (Engineer) have the finance strip and SoD row
  // relocated to the Overview "Financial summary" aside. Finance-forward roles (Admin·Exec·Finance·PM)
  // keep the header unchanged. FE-only reprioritization — never hides RLS-permitted data.
  const isFinanceForward = hasFinanceView(realRole);

  const canEdit = may('edit', 'project');
  const canArchive = may('archive', 'project');
  const canDelete = may('delete', 'project'); // Admin-only (rbac-visibility §B2/§K).
  const canEditValue = may('editContractValue', 'project', { record: { status } });

  const meta = [
    project.client?.name ?? null,
    project.code ? `· ${project.code}` : null,
    project.customer_contract_ref
      ? `· ${
          project.contract_date
            ? t('projectDetail.header.poWithDate', 'PO {{ref}} ({{date}})', {
                ref: project.customer_contract_ref,
                date: formatDate(project.contract_date),
              })
            : t('projectDetail.header.po', 'PO {{ref}}', { ref: project.customer_contract_ref })
        }`
      : null,
  ]
    .filter(Boolean)
    .join(' ');

  const tiles: StatTile[] = [
    {
      label: t('projectDetail.header.tile.contract', 'Contract'),
      value: formatCurrency(contract, project.currency),
      // OD-TAX-1 §2: the ceiling states its basis. From THIS project's stored `tax_treatment` —
      // never the org default, which pre-selects a form and is never read to interpret a row. A
      // NULL treatment (0197 pairs it with a zero contract value) renders nothing at all.
      sub: <TaxBasisLabel treatment={project.tax_treatment} testId="contract-tile-tax-basis" />,
    },
    { label: t('projectDetail.header.tile.committed', 'Committed'), value: formatCurrency(committed, project.currency) },
    // AC-MONEY-01: "Actual" = committed-PO basis (Ordered..Paid), matching Committed.
    // Both tiles intentionally show the same number — they are the same realized-spend
    // basis (OD-BUDGET-2). "Committed" is the canonical label per glossary §Committed;
    // "Actual" is the human label per the original finance-strip design. The dead
    // projects.spent column (always 0) is NOT used here.
    { label: t('projectDetail.header.tile.actual', 'Actual'), value: formatCurrency(committed, project.currency) },
    {
      label: t('projectDetail.header.tile.margin', 'On-hand margin'),
      value: signedCurrency(margin, project.currency),
      tone: margin < 0 ? 'neg' : 'pos',
    },
    { label: t('projectDetail.header.tile.spend', 'Spend'), value: `${spendPct}%` },
  ];

  const beginValueEdit = () => {
    // Seed the editor with the formatted figure ("5,000,000"), not the raw number. The tax fields
    // are deliberately NOT seeded — see the state declaration.
    setValueDraft(formatThousands(String(contract)));
    setTaxTreatmentDraft('');
    setTaxAmountDraft('');
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
  // `parseMoneyInput` is the single money parse (validation AND persistence) for both figures; a
  // local `Number()` parse here would silently diverge from the #468 locale fix.
  const parsedValue = parseMoneyInput(valueDraft);
  const parsedTax = parseTaxFacts(taxTreatmentDraft, taxAmountDraft);
  const stagedValue: PendingContractValue | null =
    parsedValue !== null && parsedValue >= 0 && parsedTax !== null
      ? { value: parsedValue, ...parsedTax }
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
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
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

  const actions = (
    <>
      {canEdit && (
        <Button variant="outline" size="sm" onClick={onEditProject}>
          {t('projectDetail.header.action.edit', 'Edit')}
        </Button>
      )}
      {canArchive && (
        <Button variant="ghost" size="sm" onClick={() => setArchiveOpen(true)}>
          {t('projectDetail.header.action.archive', 'Archive')}
        </Button>
      )}
      {canDelete && (
        // Quiet ghost trigger with destructive text (the solid red stays inside the
        // confirm — crud-components §2.2 "one solid destructive"); spatially after the
        // safer Archive (destructive-nav-separation).
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setDeleteOpen(true)}
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          {t('projectDetail.header.action.delete', 'Delete')}
        </Button>
      )}
    </>
  );

  /** The contract-value SoD row — shared between header (finance-forward) and the
   *  Financial summary aside (delivery-forward). Always read-only for Engineers. */
  const sodRow = isDelivery ? (
    <div
      data-testid="contract-value-sod"
      className="flex flex-wrap items-center gap-3 py-1"
    >
      {valueEditing && isFinanceForward ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-[180px]">
            <NumberField
              label={t('projectDetail.header.contractValue', 'Contract value')}
              prefix="$"
              value={valueDraft}
              onChange={(v) => setValueDraft(formatThousands(v))}
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
          <div className="w-[160px]">
            <NumberField
              label={t('projectDetail.header.taxAmount', 'Tax amount')}
              prefix="$"
              value={taxAmountDraft}
              onChange={(v) => setTaxAmountDraft(formatThousands(v))}
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
              className="basis-full text-[12px] text-muted-foreground"
            >
              {CONTRACT_TAX_REQUIRED_HINT}
            </p>
          )}
        </div>
      ) : (
        <span className="flex items-center gap-2.5">
          <span className="text-[12.5px] font-semibold text-muted-foreground">
            {t('projectDetail.header.contractValue', 'Contract value')}
          </span>
          <span className="text-[15px] font-bold tabular tracking-[-0.01em]">
            {formatCurrency(contract, project.currency)}
          </span>
          {/* OD-TAX-1 §2 — the SoD row's own copy of the figure states its basis too. Two figures
              on one screen with one caption between them is how a reader ends up applying the
              wrong basis to the wrong number. */}
          <TaxBasisLabel treatment={project.tax_treatment} testId="contract-value-tax-basis" />
          {canEditValue && isFinanceForward ? (
            <Button
              variant="outline"
              size="sm"
              onClick={beginValueEdit}
              aria-label={t('projectDetail.header.editContractValue', 'Edit contract value')}
            >
              {t('projectDetail.header.action.edit', 'Edit')}
            </Button>
          ) : isOnHand ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
              <Icon name="lock" className="size-3" />
              {t('projectDetail.header.readOnly', 'Read-only')}
            </span>
          ) : null}
        </span>
      )}
      {isOnHand && canEditValue && isFinanceForward && !valueEditing && (
        <span className="basis-full text-[12px] text-muted-foreground">
          {t(
            'projectDetail.header.sodEditableNote',
            'Changing the value on a won project is a segregation-of-duties action and is recorded.',
          )}
        </span>
      )}
      {isOnHand && (!canEditValue || !isFinanceForward) && (
        <span className="basis-full text-[12px] text-muted-foreground">
          {t(
            'projectDetail.header.sodLockedNote',
            'Once a project is won, the contract value is locked for your role. Only Executive or Finance can change it, and the change is recorded.',
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
        name={project.name}
        status={
          <StatusPill variant={pillVariantForProjectStatus(status)}>{project.status}</StatusPill>
        }
        meta={meta || undefined}
        actions={canEdit || canArchive || canDelete ? actions : undefined}
      />

      {/* Finance-forward roles (Admin·Exec·Finance·PM): keep the delivery finance strip
          + SoD row in the header, exactly as shipped (OD-W5-C3-A). The strip renders
          borderless (content-over-containers) so the page leads with content, not boxes. */}
      {isDelivery && isFinanceForward && (
        <>
          <StatTiles tiles={tiles} columns={5} variant="bare" className="mb-4" />
          <div className="mb-4">{sodRow}</div>
        </>
      )}

      {/* Delivery-forward roles (Engineer): the finance strip and SoD row are relocated
          INTO the Overview "Financial summary" section (rendered in OverviewTab, below the
          tab bar). Nothing is mounted here so the Engineer header ends at the delivery-meta
          row — no finance above the tab bar (D15, OD-W5-C3-A). */}

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
              {/* ⛔ NOT TRANSLATED, deliberately — see docs note in the handover.
                  This sentence interleaves four bold spans, so it needs <Trans>. <Trans>
                  renders NOTHING when i18next has not been initialised, and the unit-test
                  runner never calls initI18n() — so translating it here blanks the entire
                  confirm body under test (and during app boot, before init resolves).
                  Splitting it into five gluable fragments is the other option and is worse:
                  Indonesian reorders this sentence and fragments cannot be reordered.
                  Unblocks the moment the test setup initialises i18next. */}
              You are changing the contract value of a won project from{' '}
              <b className="tabular text-foreground">{formatCurrency(contract, project.currency)}</b> to{' '}
              <b className="tabular text-foreground">{formatCurrency(pendingValue.value, project.currency)}</b>,
              stated as <b className="text-foreground">{pendingValue.taxTreatment}</b> of{' '}
              <b className="tabular text-foreground">{formatCurrency(pendingValue.taxAmount, project.currency)}</b>{' '}
              tax.
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
