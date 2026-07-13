/**
 * Fix #5 — Inline expand/preview for the procurement list (AC-FIX5-PREVIEW-*).
 *
 * Reuses the expand + DecisionSupportPanel + line-items pattern from
 * ProcurementApprovalRow, but READ-ONLY (no approve/reject actions).
 * Each row can expand in-place to preview budget impact + line items,
 * then navigate to the full detail page via "View full request".
 *
 * The row header mirrors the DataTable columns (title, code, project, requester,
 * value, status pill, lifecycle stepper) so the preview list feels like the table.
 */
import React, { useId, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Icon, ListState, StatusPill, ProjectNameLink } from '@/src/components/ui';
import { trackProcurementDetailOpened } from '@/src/lib/analytics';
import { useProcurementDetail } from '@/src/hooks/useProcurementDetail';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import { formatCurrency } from '@/src/lib/format';
import { DecisionSupportPanel } from './DecisionSupportPanel';
import { pillVariantForStatus, stageLabelForStatus, lifecycleSteps } from '../../components/procurement';
import type { ProcurementStatus } from '@/src/lib/db/procurementLifecycle';
import { LifecycleStepper } from '@/src/components/ui';

export interface ProcurementListRowProps {
  row: ProcurementWithRefs;
}

/** Whole days since an ISO timestamp. */
function daysAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const days = Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
  if (days === 0) return 'today';
  return `${days}d ago`;
}

/**
 * AC-FIX5-PREVIEW-01/02/03: a procurement list row with an in-place expand toggle.
 * Clicking the disclosure chevron reveals a read-only preview panel:
 *   • DecisionSupportPanel (budget impact — lazy, only when expanded)
 *   • Line items list
 *   • "View full request" link → /procurement/:id (no force-drill required)
 */
/**
 * The expanded preview panel — rendered as a separate component so that
 * `useProcurementDetail` is only called when the panel is actually mounted
 * (expanded). This keeps the hook call unconditional within the component
 * while avoiding a QueryClient dependency in the always-rendered row header.
 */
const ExpandedPanel: React.FC<{ row: ProcurementWithRefs; panelId: string }> = ({ row, panelId }) => {
  const detail = useProcurementDetail(row.id);

  return (
    <div
      id={panelId}
      role="region"
      aria-label={`Preview for ${row.title}`}
      className="mx-3.5 mb-3 rounded-lg border border-border bg-secondary/20 p-3"
    >
      {detail.isPending ? (
        <ListState variant="loading" rows={3} />
      ) : detail.isError ? (
        <ListState
          variant="error"
          title="Couldn't load request details"
          sub="Something went wrong fetching the preview."
          onRetry={() => detail.refetch()}
        />
      ) : detail.data ? (
        <>
          {/* Budget impact */}
          <DecisionSupportPanel
            projectId={detail.data.project_id}
            totalValue={detail.data.total_value}
            projectName={detail.data.project?.name}
            status={detail.data.status}
          />

          {/* Line items */}
          {detail.data.items.length > 0 && (
            <div className="mb-3">
              <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                Line items
              </h4>
              <ul className="space-y-1" aria-label="Line items">
                {detail.data.items.map((item) => {
                  const lineTotal = item.amount ?? item.quantity * item.rate;
                  return (
                    <li
                      key={item.id}
                      className="flex items-baseline justify-between gap-2 text-[13px]"
                    >
                      <span className="truncate">{item.name}</span>
                      <span className="tabular text-muted-foreground shrink-0">
                        {item.quantity} × {formatCurrency(item.rate)} ={' '}
                        <span className="font-medium text-foreground">
                          {formatCurrency(lineTotal)}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Navigation footer (AC-FIX5-PREVIEW-03): View full request */}
          <div className="mt-2 flex justify-end">
            <Link
              to={`/procurement/${row.id}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-[13px] font-medium text-foreground transition-colors hover:bg-accent"
            >
              View full request
              <Icon name="chev" aria-hidden />
            </Link>
          </div>
        </>
      ) : null}
    </div>
  );
};

export const ProcurementListRow: React.FC<ProcurementListRowProps> = ({ row }) => {
  const panelId = `proc-list-panel-${useId()}`;
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();

  return (
    <div className="border-b border-border last:border-b-0">
      {/* Row summary — always visible.
          AC-ROWCLICK-PROCLIST: this is a NAVIGATION list, so a whole-row click
          opens the detail page (/procurement/:id) — not just the title link. The
          disclosure chevron, the title <Link>, and the project-name link are
          interactive and excluded by the closest() guard (the chevron keeps its
          expand behaviour; the inner links keep their own declarative href). The
          title <Link> stays the keyboard/AT affordance — the row click is a
          pointer convenience layered on top. */}
      <div
        data-row-activate
        onClick={(e) => {
          if (
            (e.target as HTMLElement).closest(
              'button, a, select, input, textarea, label, [role="menuitem"], [contenteditable]'
            )
          )
            return;
          trackProcurementDetailOpened('/procurement/:procurementId', 'list');
          navigate(`/procurement/${row.id}`);
        }}
        className="flex cursor-pointer flex-wrap items-start gap-2 px-3.5 py-3 transition-colors hover:bg-accent/60">
        {/* Disclosure toggle (AC-FIX5-PREVIEW-01) */}
        <Button
          variant="ghost"
          size="icon"
          aria-expanded={expanded}
          aria-controls={panelId}
          aria-label={`Show preview for ${row.title}`}
          onClick={() => setExpanded((v) => !v)}
          className={
            expanded
              ? '[&_svg]:rotate-90 [&_svg]:transition-transform'
              : '[&_svg]:transition-transform'
          }
        >
          <Icon name="chev" />
        </Button>

        {/* Request info — title is a Link so clicking the row title navigates (AC-NAV-006) */}
        <div className="min-w-0 flex-1">
          <Link
            to={`/procurement/${row.id}`}
            className="block truncate font-semibold text-[13px] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
            title={row.title}
          >
            {row.title}
          </Link>
          <div className="font-mono text-[12px] text-muted-foreground">
            {row.code ?? row.id.slice(0, 8)}
          </div>
        </div>

        {/* Meta — on phones drop to its own full-width line and wrap its items
            (was `shrink-0`, which forced the block to its ~817px intrinsic width and
            clipped the amount/status off the right edge under the shell's
            overflow-x-hidden; AC-MOBILE-OVERFLOW-001). ≥640px: inline, non-shrinking. */}
        <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted-foreground sm:w-auto sm:shrink-0">
          {row.project?.name && (
            <ProjectNameLink projectId={row.project_id} name={row.project.name} />
          )}
          {row.requested_by?.full_name && <span>{row.requested_by.full_name}</span>}
          <span className="tabular font-medium text-foreground">
            {formatCurrency(row.total_value)}
          </span>
          <span>{daysAgo(row.created_at)}</span>
          <StatusPill variant={pillVariantForStatus(row.status as ProcurementStatus)}>
            {stageLabelForStatus(row.status as ProcurementStatus)}
          </StatusPill>
          <LifecycleStepper
            variant="inline"
            steps={lifecycleSteps(row.status as ProcurementStatus)}
            aria-label={`Lifecycle: ${stageLabelForStatus(row.status as ProcurementStatus)}`}
          />
        </div>
      </div>

      {/* Expanded preview panel (AC-FIX5-PREVIEW-02): ExpandedPanel mounts only when
          expanded so useProcurementDetail is not called on the collapsed row. */}
      {expanded && <ExpandedPanel row={row} panelId={panelId} />}
    </div>
  );
};
