/**
 * ProcurementOverviewTab — the Overview-tab bento orchestrator.
 *
 * A 2-column bento (DESIGN.md / option-h-hybrid contract):
 *   • left 2/3 (ov-main): StatTiles (2×2) → the Budget signal (DecisionSupportPanel) →
 *     the Detail `<dl>`.
 *   • right 1/3 (ov-side, sticky on desktop): the Progression timeline (history folded
 *     in — there is NO separate History tab).
 *
 * Responsive via the app's REAL breakpoint (`lg:`, the rail-collapse boundary), NOT the
 * mockup's container-query trick: the grid collapses to a single column below `lg`, so
 * the Progression timeline drops BELOW the stats/budget/detail; the Detail `<dl>` goes
 * 2-col → 1-col; the side slot is `lg:sticky` (static on mobile). Single DOM branch per
 * breakpoint — no dual a11y tree. Token-pure (DESIGN.md §6).
 */
import React from 'react';
import { Card, CardHead, CardPad, StatTiles, type StatTile } from '@/src/components/ui';
import type { ProgressionEvent } from '@/src/lib/db/procurementHistory';
import type { ProcurementStatus } from '@/src/lib/db/procurementLifecycle';
import { DecisionSupportPanel } from './DecisionSupportPanel';
import { ProcurementProgressionTimeline } from './ProcurementProgressionTimeline';

/** One row in the Overview Detail `<dl>` (the Field grammar: overline dt + dd). */
export interface DetailRow {
  label: string;
  value: React.ReactNode;
}

export interface ProcurementOverviewTabProps {
  /** Stat tiles (2×2 on the bento; sparse auto-fits when < 3). */
  tiles: StatTile[];
  /** The Detail `<dl>` rows. */
  detailRows: DetailRow[];
  /** Progression-history events (ASCENDING by time; the timeline presents newest-first). */
  events: ProgressionEvent[];
  /** Linked project id (drives the Budget signal; null/undefined omits it). */
  projectId: string | null | undefined;
  /** Linked project display name. */
  projectName: string | null | undefined;
  /** This request's total_value (the Budget signal "This request" figure). */
  totalValue: number;
  /** The case's current status — drives the Budget signal's per-stage math + visibility. */
  status: ProcurementStatus;
}

export const ProcurementOverviewTab: React.FC<ProcurementOverviewTabProps> = ({
  tiles,
  detailRows,
  events,
  projectId,
  projectName,
  totalValue,
  status,
}) => (
  <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
    {/* ── ov-main (left 2/3) ─────────────────────────────────────────────── */}
    <div className="min-w-0">
      {/* StatTiles 2×2. `columns={2}` is the bento layout; the strip auto-fits
          when sparse (e.g. a single Draft tile). */}
      <StatTiles tiles={tiles} columns={2} className="mb-4" />

      {/* Budget signal — renders only when project_id is set (no empty card). */}
      <DecisionSupportPanel
        projectId={projectId}
        totalValue={totalValue}
        projectName={projectName ?? null}
        status={status}
      />

      {/* Detail <dl> — the Field grammar (overline dt + dd). 2-col on desktop,
          1-col below the rail-collapse breakpoint. */}
      <Card>
        <CardHead>Detail</CardHead>
        <CardPad>
          <dl
            data-testid="procurement-detail-dl"
            className="grid grid-cols-1 gap-x-8 gap-y-3.5 lg:grid-cols-2"
          >
            {detailRows.map((row) => (
              <div key={row.label}>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                  {row.label}
                </dt>
                <dd className="mt-0.5 text-[13.5px]">{row.value}</dd>
              </div>
            ))}
          </dl>
        </CardPad>
      </Card>
    </div>

    {/* ── ov-side (right 1/3, sticky on desktop) ─────────────────────────── */}
    <aside data-testid="procurement-progression" className="min-w-0 lg:sticky lg:top-4">
      <Card>
        <CardHead>Progression</CardHead>
        <CardPad>
          <ProcurementProgressionTimeline events={events} />
        </CardPad>
      </Card>
    </aside>
  </div>
);

ProcurementOverviewTab.displayName = 'ProcurementOverviewTab';
