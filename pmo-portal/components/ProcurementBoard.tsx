import React from 'react';
import { Kanban, KanbanColumn, KanbanCard } from '@/src/components/ui';
import { formatCurrency } from '@/src/lib/format';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import type { ProcurementStatus } from '@/src/lib/db/procurementLifecycle';
import { PR_STAGES, stageIndexForStatus } from './procurement';

interface ProcurementBoardProps {
  procurements: ProcurementWithRefs[];
  /** Drill into a PR's lifecycle detail (opens a workspace record tab). */
  onOpen: (procurement: ProcurementWithRefs) => void;
  /** Currently-open PR id — highlights its card. */
  selectedId?: string;
}

/** Initial-letter avatar tile for the requester (categorical, non-interactive). */
const Initial: React.FC<{ name: string | undefined }> = ({ name }) => {
  const initial = (name ?? '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      aria-hidden
      title={name ?? undefined}
      className="grid size-[22px] shrink-0 place-items-center rounded-full bg-secondary text-[10px] font-bold text-muted-foreground"
    >
      {initial}
    </span>
  );
};

/** A compact purchase-request card (DESIGN.md "Kanban Card" signature, dense). */
const PrCard: React.FC<{
  pr: ProcurementWithRefs;
  selected: boolean;
  onActivate: () => void;
}> = ({ pr, selected, onActivate }) => (
  <KanbanCard selected={selected} onActivate={onActivate} aria-label={`Open ${pr.title}`}>
    <div className="line-clamp-2 text-[13px] font-semibold leading-snug" title={pr.title}>
      {pr.title}
    </div>
    <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
      {pr.code ?? pr.id.slice(0, 8)}
    </div>
    <div className="mt-2 text-[15px] font-bold tabular">{formatCurrency(pr.total_value, pr.currency)}</div>
    <div className="mt-2.5 flex items-center gap-2 border-t border-border/70 pt-2">
      <Initial name={pr.requested_by?.full_name} />
      {/* C-PR-2/E-2: render project as INERT text (not a Link) so the card has
          a single activation target and there is no nested interactive element
          inside the role=button KanbanCard (invalid HTML). Navigate to the project
          via the procurement detail page which already links there. */}
      <span
        aria-label={pr.project?.name ? `Project: ${pr.project.name}` : undefined}
        className="truncate text-[11px] text-muted-foreground"
      >
        {pr.project?.name ?? '—'}
      </span>
    </div>
  </KanbanCard>
);

/**
 * The IA-3 procurement by-stage board: six fixed columns grouped by the PR
 * lifecycle stage (PR → VQ → PO → GR → VI → Paid), reusing the Foundation Kanban
 * shell. Terminal off-track requests (Rejected / Cancelled) never reach a stage
 * node so they are excluded from the board (visible in the Table view). Cards are
 * keyboard-activatable and drill into the PR lifecycle detail page. (Owner
 * directive 2026-06-21: approval is a gate, not a stage — an Approved request
 * sits in the Vendor Quote column, the bar advanced on approval.)
 */
const ProcurementBoard: React.FC<ProcurementBoardProps> = ({ procurements, onOpen, selectedId }) => {
  // Bucket once: each in-flight request lands in exactly one stage column.
  const byStage: ProcurementWithRefs[][] = PR_STAGES.map(() => []);
  for (const pr of procurements) {
    const idx = stageIndexForStatus(pr.status as ProcurementStatus);
    if (idx >= 0) byStage[idx].push(pr);
  }

  return (
    <Kanban aria-label="Procurement by-stage board">
      {PR_STAGES.map((stage, i) => {
        const items = byStage[i];
        // DD-CUR-6 (#530 item 3): a mixed-currency total is a PER-CURRENCY BREAKDOWN, never a
        // converted figure and never the first row's label on everyone's money.
        //
        // ⛔ What this replaces was silently wrong the moment a stage held two currencies: it summed
        // across them and labelled the result with `items[0].currency`, so an IDR request sitting
        // behind a USD one turned the column total into a number that is not any real quantity —
        // rendered with the confidence of a real one, and the reader could not recover the parts.
        //
        // Not converted, because PMO holds no exchange rates: acquiring them is a commercial
        // decision carrying a staleness policy and an "as of when" on every figure, and a converted
        // total is LOSSIER than its inputs. A breakdown is exact, needs nothing we do not already
        // hold, and degrades to exactly today's single line when a stage is single-currency —
        // which is every stage in a single-currency org.
        const stageTotals = (() => {
          const byCurrency = new Map<string, number>();
          for (const p of items) {
            byCurrency.set(p.currency, (byCurrency.get(p.currency) ?? 0) + p.total_value);
          }
          // Deterministic order: a column that reshuffles its subtotals between renders reads as
          // movement in the data.
          return [...byCurrency.entries()].sort(([a], [b]) => a.localeCompare(b));
        })();
        return (
          <div key={stage.key} data-testid={`prstage-${stage.key}`} className="flex min-w-0 flex-col">
            <KanbanColumn
              title={stage.full}
              // I2 — ONE board convention (matches the sales board): quiet
              // neutral upstream columns, the status hue only at the terminal.
              // The board groups ALL records by stage, so there is no single
              // "active" stage to render blue (mirrors the procurement pill).
              dotColor={stage.key === 'paid' ? 'hsl(var(--success))' : 'hsl(var(--muted-foreground))'}
              count={items.length}
              totals={
                items.length > 0 ? (
                  <span data-testid={`prstage-${stage.key}-totals`} className="flex flex-col items-end">
                    {stageTotals.map(([code, sum]) => (
                      <span key={code} className="text-[13px] font-bold tabular">
                        {formatCurrency(sum, code)}
                      </span>
                    ))}
                  </span>
                ) : undefined
              }
              emptyMessage={`No requests at ${stage.full}`}
            >
              {items.map((pr) => (
                <PrCard
                  key={pr.id}
                  pr={pr}
                  selected={pr.id === selectedId}
                  onActivate={() => onOpen(pr)}
                />
              ))}
            </KanbanColumn>
          </div>
        );
      })}
    </Kanban>
  );
};

export default ProcurementBoard;
