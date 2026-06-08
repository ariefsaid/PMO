import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  PageHeader,
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
import { useProjectMutations } from '@/src/hooks/useProjects';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatCurrency } from '@/src/lib/format';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { ON_HAND_STATUSES } from '@/src/lib/db/projectTransitions';
import { pillVariantForProjectStatus, projectIconColor } from '../../components/projects';
import ProjectFormModal from '../../components/ProjectFormModal';

export interface ProjectDetailHeaderProps {
  project: ProjectWithRefs;
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
const ProjectDetailHeader: React.FC<ProjectDetailHeaderProps> = ({ project }) => {
  const may = usePermission();
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
  const committed = project.budget ?? 0;
  const spent = project.spent ?? 0;
  const margin = contract - spent;
  const spendPct = contract > 0 ? Math.round((spent / contract) * 100) : 0;

  const status = project.status as string;
  const isOnHand = ON_HAND_STATUSES.includes(status);

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
    { label: 'Actual', value: formatCurrency(spent) },
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

  return (
    <>
      <PageHeader
        icon={(project.name.trim().charAt(0) || '•').toUpperCase()}
        iconColor={projectIconColor()}
        name={project.name}
        status={
          <StatusPill variant={pillVariantForProjectStatus(status)}>{project.status}</StatusPill>
        }
        meta={meta || undefined}
        actions={canEdit || canArchive || canDelete ? actions : undefined}
      />
      <StatTiles tiles={tiles} columns={5} className="mb-4" />

      {/* contract_value SoD treatment (ADR-0019). Rendered as a small dedicated row so the
          read-only / editable / audit distinction is explicit (the StatTiles strip stays a
          read-only summary). */}
      <div
        data-testid="contract-value-sod"
        className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3"
      >
        {valueEditing ? (
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
            {canEditValue ? (
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
        {isOnHand && canEditValue && !valueEditing && (
          <span className="basis-full text-[12px] text-muted-foreground">
            Changing the value on a won project is a segregation-of-duties action and is recorded.
          </span>
        )}
        {isOnHand && !canEditValue && (
          <span className="basis-full text-[12px] text-muted-foreground">
            Once a project is won, the contract value is locked for your role. Only Executive or
            Finance can change it, and the change is recorded.
          </span>
        )}
      </div>

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
