import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  RecordHeader,
  StatTiles,
  StatusPill,
  Button,
  Icon,
  NumberField,
  ConfirmDialog,
  GateNotice,
  useToast,
  type StatTile,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useProjectMutations } from '@/src/hooks/useProjects';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatCurrency } from '@/src/lib/format';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import type { Role } from '@/src/auth/AuthContext';
import { ON_HAND_STATUSES, projectStatusGroup } from '@/src/lib/db/projectTransitions';
import { pillVariantForProjectStatus, projectIconColor } from '../../components/projects';
import ProjectFormModal from '../../components/ProjectFormModal';

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

export interface ProjectDetailHeaderProps {
  project: ProjectWithRefs;
  committedSpend?: number;
}

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : '—';
}

/** Currency with a true minus glyph (U+2212) for negatives (number rigor). */
function signedCurrency(value: number): string {
  if (value < 0) return `−${formatCurrency(Math.abs(value))}`;
  return formatCurrency(value);
}

/** Parse a formatted money string ("5,140,000") to a number; empty → 0. */
function parseMoney(raw: string): number {
  const n = Number(raw.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
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
const ProjectDetailHeader: React.FC<ProjectDetailHeaderProps> = ({ project, committedSpend }) => {
  const may = usePermission();
  const { realRole } = useEffectiveRole();
  const { toast } = useToast();
  const { updateHeader, archive, remove, setContractValue } = useProjectMutations();
  const navigate = useNavigate();

  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // contract_value inline-edit state.
  const [valueEditing, setValueEditing] = useState(false);
  const [valueDraft, setValueDraft] = useState('');
  // The audit-confirm holds the pending new value until the user confirms the SoD action.
  const [pendingValue, setPendingValue] = useState<number | null>(null);

  const contract = project.contract_value ?? 0;
  const committed = committedSpend ?? 0;
  // AC-MONEY-01: "Actual" is the committed-PO basis (Ordered..Paid), not the dead stored
  // projects.spent column which is never populated (0001_init_schema.sql:79 DEFERRED).
  // committed == actual (Ordered..Paid sum) — both reflect realized procurement spend.
  const activeBudget = project.budget ?? 0;
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
      ? `· PO ${project.customer_contract_ref}${project.contract_date ? ` (${fmtDate(project.contract_date)})` : ''}`
      : null,
  ]
    .filter(Boolean)
    .join(' ');

  const tiles: StatTile[] = [
    { label: 'Contract', value: formatCurrency(contract) },
    { label: 'Committed', value: formatCurrency(committed) },
    // AC-MONEY-01: "Actual" = committed-PO basis (Ordered..Paid), matching Committed.
    // Both tiles intentionally show the same number — they are the same realized-spend
    // basis (OD-BUDGET-2). "Committed" is the canonical label per glossary §Committed;
    // "Actual" is the human label per the original finance-strip design. The dead
    // projects.spent column (always 0) is NOT used here.
    { label: 'Actual', value: formatCurrency(committed) },
    {
      label: 'On-hand margin',
      value: signedCurrency(margin),
      tone: margin < 0 ? 'neg' : 'pos',
    },
    { label: 'Spend', value: `${spendPct}%` },
  ];

  const beginValueEdit = () => {
    // Seed the editor with the formatted figure ("5,000,000"), not the raw number.
    setValueDraft(formatThousands(String(contract)));
    setValueEditing(true);
  };

  const cancelValueEdit = () => {
    setValueEditing(false);
    setValueDraft('');
  };

  // Save the value. On a WON/on-hand project this is a segregation-of-duties action →
  // stage it for the audit confirm. Pre-win, commit straight away (no SoD confirm).
  const onValueSave = () => {
    const next = parseMoney(valueDraft);
    if (isOnHand) {
      setPendingValue(next);
    } else {
      void commitValue(next);
    }
  };

  const commitValue = async (next: number) => {
    try {
      await setContractValue.mutateAsync({ id: project.id, value: next });
      toast('Contract value updated', formatCurrency(next), 'success');
      setValueEditing(false);
      setValueDraft('');
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
      toast('Project archived', project.name, 'success');
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
      toast('Project deleted', project.name, 'success');
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
        <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
          Edit
        </Button>
      )}
      {canArchive && (
        <Button variant="ghost" size="sm" onClick={() => setArchiveOpen(true)}>
          Archive
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
          Delete
        </Button>
      )}
    </>
  );

  /** The contract-value SoD row — shared between header (finance-forward) and the
   *  Financial summary aside (delivery-forward). Always read-only for Engineers. */
  const sodRow = isDelivery ? (
    <div
      data-testid="contract-value-sod"
      className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3"
    >
      {valueEditing && isFinanceForward ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-[180px]">
            <NumberField
              label="Contract value"
              prefix="$"
              value={valueDraft}
              onChange={(v) => setValueDraft(formatThousands(v))}
            />
          </div>
          <Button variant="primary" size="sm" onClick={onValueSave} loading={setContractValue.isPending}>
            Save
          </Button>
          <Button variant="ghost" size="sm" onClick={cancelValueEdit}>
            Cancel
          </Button>
        </div>
      ) : (
        <span className="flex items-center gap-2.5">
          <span className="text-[12.5px] font-semibold text-muted-foreground">Contract value</span>
          <span className="text-[15px] font-bold tabular tracking-[-0.01em]">
            {formatCurrency(contract)}
          </span>
          {canEditValue && isFinanceForward ? (
            <Button variant="outline" size="sm" onClick={beginValueEdit} aria-label="Edit contract value">
              Edit
            </Button>
          ) : isOnHand ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
              <Icon name="lock" className="size-3" />
              Read-only
            </span>
          ) : null}
        </span>
      )}
      {isOnHand && canEditValue && isFinanceForward && !valueEditing && (
        <span className="basis-full text-[12px] text-muted-foreground">
          Changing the value on a won project is a segregation-of-duties action and is recorded.
        </span>
      )}
      {isOnHand && (!canEditValue || !isFinanceForward) && (
        <span className="basis-full text-[12px] text-muted-foreground">
          Once a project is won, the contract value is locked for your role. Only Executive or
          Finance can change it, and the change is recorded.
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
          + SoD row in the header, exactly as shipped (OD-W5-C3-A). */}
      {isDelivery && isFinanceForward && (
        <>
          <StatTiles tiles={tiles} columns={5} className="mb-4" />
          <div className="mb-4">{sodRow}</div>
        </>
      )}

      {/* Delivery-forward roles (Engineer): the finance strip and SoD row are relocated
          INTO the Overview "Financial summary" section (rendered in OverviewTab, below the
          tab bar). Nothing is mounted here so the Engineer header ends at the delivery-meta
          row — no finance above the tab bar (D15, OD-W5-C3-A). */}

      {/* Edit-header modal (Admin·Exec·PM). */}
      {editOpen && (
        <ProjectFormModal
          mode="editHeader"
          initial={{
            id: project.id,
            name: project.name,
            code: project.code,
            client_id: project.client_id,
            project_manager_id: project.project_manager_id,
            clientName: project.client?.name ?? null,
            pmName: project.pm?.full_name ?? null,
            start_date: project.start_date,
            end_date: project.end_date,
          }}
          onClose={() => setEditOpen(false)}
          onSave={async (id, input) => {
            await updateHeader.mutateAsync({ id, input });
            toast('Project updated', input.name, 'success');
            setEditOpen(false);
          }}
          onError={(err) => {
            const { headline, detail } = classifyMutationError(err);
            toast(headline, detail, 'warning');
          }}
        />
      )}

      {/* Archive confirm (destructive tone — leaves the active list). */}
      <ConfirmDialog
        open={archiveOpen}
        tone="destructive"
        title={`Archive ${project.name}?`}
        description="It will be hidden from the default project list. Existing references stay intact. You can restore it later."
        confirmLabel="Archive project"
        loading={archive.isPending}
        onConfirm={onArchiveConfirm}
        onCancel={() => setArchiveOpen(false)}
      />

      {/* Hard-delete confirm (destructive tone, Admin-only). Names the irreversibility +
          recommends Archive as the recoverable alternative (error-recovery). */}
      <ConfirmDialog
        open={deleteOpen}
        tone="destructive"
        title={`Delete ${project.name}?`}
        description="This permanently removes the project and its budget, tasks, and documents. It can't be undone, and a project with procurement or logged time can't be deleted. Archive it instead if you only need to hide it."
        confirmLabel="Delete project"
        loading={remove.isPending}
        onConfirm={onDeleteConfirm}
        onCancel={() => setDeleteOpen(false)}
      />

      {/* contract_value SoD audit confirm (default tone) — names the SoD reason in the body. */}
      <ConfirmDialog
        open={pendingValue !== null}
        tone="default"
        title="Change the contract value?"
        description={
          pendingValue !== null ? (
            <>
              You are changing the contract value of a won project from{' '}
              <b className="tabular text-foreground">{formatCurrency(contract)}</b> to{' '}
              <b className="tabular text-foreground">{formatCurrency(pendingValue)}</b>.
              <GateNotice variant="blocked" className="mt-3">
                Changing the contract value on a won project is a segregation of duties action and
                is recorded against your name, the date, and the previous value.
              </GateNotice>
            </>
          ) : (
            ''
          )
        }
        confirmLabel="Change and record"
        loading={setContractValue.isPending}
        onConfirm={() => pendingValue !== null && void commitValue(pendingValue)}
        onCancel={() => setPendingValue(null)}
      />
    </>
  );
};

export default ProjectDetailHeader;
