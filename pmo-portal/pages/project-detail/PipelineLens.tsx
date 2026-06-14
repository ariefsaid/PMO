import React, { useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Card,
  CardHead,
  CardPad,
  Button,
  StatTiles,
  LifecycleStepper,
  GateNotice,
  RecordActionZone,
  Icon,
  ConfirmDialog,
  useToast,
  type StatTile,
} from '@/src/components/ui';
import { useSalesPipeline } from '@/src/hooks/useDashboard';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { formatCurrency } from '@/src/lib/format';
import {
  transitionProject,
  LEGAL_PROJECT_TRANSITIONS,
  PIPELINE_STATUSES,
  projectStatusGroup,
} from '@/src/lib/db/projectTransitions';
import {
  weightedValue,
  formatPercent,
  dealJourneySteps,
} from '../../components/salesPipeline';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

const NEXT_PIPELINE_LABEL: Record<string, string> = {
  Leads: 'Pre-Qual',
  'PQ Submitted': 'Quotation',
  'Quotation Submitted': 'Tender',
  'Tender Submitted': 'Negotiation',
};

export interface PipelineLensProps {
  /** The canonical project/opportunity row (the active detail record). */
  project: ProjectWithRefs;
}

/**
 * The pre-win (pipeline | lost) lens of the canonical `/projects/:id` detail page (Model B,
 * ADR-0020). Extracted from the retired `OpportunityDetail` route body so the future Model-A
 * `opportunities` detail page is a lift, not a rewrite. It reads the live status + money from
 * the passed-in project row and enriches win-probability / weighted from the `useSalesPipeline`
 * cache, and drives the deal forward through `transitionProject` (the RPC contract is preserved
 * byte-for-byte). The shared `ProjectDetailHeader` (icon + name + StatusPill + meta) renders
 * above this lens in `ProjectDetail`; this panel owns only the deal-specific surfaces (stats,
 * journey stepper, and the Advance / Mark won / Mark lost actions with the inline SoD capture).
 */
const PipelineLens: React.FC<PipelineLensProps> = ({ project }) => {
  const { toast } = useToast();
  const { currentUser } = useAuth();
  const queryClient = useQueryClient();
  const may = usePermission();

  // A-1 (rbac-visibility §B2): pipeline lifecycle control (Advance / Mark won / Mark lost) is
  // a delivery-led, PM-owned write — Admin·Exec·PM (`edit` on project). Finance·Engineer are
  // read-only on the pipeline lens (§C). The gate reads the REAL JWT role (ADR-0016); RLS/RPC
  // stays the authority — a denied role sees a clean read-only note, not dead buttons.
  const canTransition = may('edit', 'project');

  const { data: pipeline } = useSalesPipeline();

  const liveStatus = project.status as string;
  // The pipeline projection carries win_probability; the project row carries the value.
  const cached = pipeline?.projects.find((p) => p.id === project.id);

  // N10 (OD-W5-C3-B): focus management after a transition — refs for the heading
  // of the Next-actions card (Advance/Lost) and the page header h1 (Won, where the
  // page becomes the delivery layout). A keyboard/SR user is told what changed.
  const nextActionsHeadRef = useRef<HTMLDivElement>(null);

  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Write policy (OD-UX-1): a routine reversible forward Advance is SINGLE-CLICK + a toast
  // (no modal) — aligned to procurement + Tasks. Only the terminal/destructive `Mark lost`
  // opens a destructive confirm; `Mark won` keeps its inline SoD capture (that consequential
  // capture IS the confirm).
  const [confirmAction, setConfirmAction] = useState<'lost' | null>(null);
  const [showWonPanel, setShowWonPanel] = useState(false);
  const [contractRef, setContractRef] = useState('');
  const [contractDate, setContractDate] = useState('');
  const [refError, setRefError] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);

  const legalTargets = useMemo(
    () => LEGAL_PROJECT_TRANSITIONS[liveStatus] ?? [],
    [liveStatus],
  );
  const canWin = legalTargets.includes('Won, Pending KoM');
  const canLose = legalTargets.includes('Loss Tender');
  const nextStage = legalTargets.find((t) => PIPELINE_STATUSES.includes(t));
  const isTerminal = projectStatusGroup(liveStatus as never) !== 'pipeline';

  const value = project.contract_value ?? cached?.contract_value ?? 0;
  const winProb = cached?.win_probability ?? 0;
  const weighted = cached ? weightedValue(cached) : 0;

  const runTransition = async (
    to: string,
    opts?: { customerContractRef?: string; contractDate?: string },
  ) => {
    setError(null);
    setPending(true);
    try {
      // Preserve the RPC contract byte-for-byte: a stage advance / loss passes
      // exactly two args (no opts); only the Won path carries the SoD opts.
      if (opts) await transitionProject(project.id, to as never, opts);
      else await transitionProject(project.id, to as never);
      await queryClient.invalidateQueries({ queryKey: ['sales-pipeline', currentUser?.org_id] });
      await queryClient.invalidateQueries({ queryKey: ['projects', currentUser?.org_id] });
      await queryClient.invalidateQueries({ queryKey: ['opportunity', currentUser?.org_id, project.id] });
      setShowWonPanel(false);
      setContractRef('');
      setContractDate('');
      setConfirmAction(null);
      toast('Project updated', `Moved to ${to}`, 'success');
      // N10 (OD-W5-C3-B): post-transition focus management. On Won the page re-renders
      // into the delivery layout; move focus to the page h1. On Advance/Lost move focus
      // to the Next-actions card heading so a keyboard/SR user is told what changed.
      if (to === 'Won, Pending KoM') {
        // Brief defer so the re-render (delivery header mounting) can complete first.
        setTimeout(() => {
          const h1 = document.querySelector<HTMLElement>('h1');
          h1?.focus();
        }, 80);
      } else {
        nextActionsHeadRef.current?.focus();
      }
    } catch (err) {
      // Surface the RPC error verbatim — it carries the P0001 SoD message.
      // Close the confirm so the verbatim error reads in the inline alert.
      setConfirmAction(null);
      setError(err instanceof Error ? err.message : 'Transition failed');
    } finally {
      setPending(false);
    }
  };

  const submitWon = () => {
    const refMissing = !contractRef.trim();
    const dateMissing = !contractDate;
    setRefError(refMissing ? 'Customer contract reference is required' : null);
    setDateError(dateMissing ? 'Contract date is required' : null);
    if (refMissing || dateMissing) return;
    void runTransition('Won, Pending KoM', {
      customerContractRef: contractRef.trim(),
      contractDate,
    });
  };

  const stats: StatTile[] = [
    { label: 'Value', value: formatCurrency(value) },
    { label: 'Win probability', value: formatPercent(winProb) },
    { label: 'Weighted', value: formatCurrency(weighted) },
    { label: 'Owner', value: project.pm?.full_name ?? 'Not set' },
    {
      label: 'Decision',
      value: project.decided_at ? new Date(project.decided_at).toLocaleDateString() : 'Pending',
    },
  ];

  return (
    <div>
      <StatTiles tiles={stats} columns={5} className="mb-4" />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Opportunity journey */}
        <Card>
          <CardHead>Project journey</CardHead>
          <CardPad>
            <LifecycleStepper
              variant="bar"
              steps={dealJourneySteps(liveStatus as never)}
              aria-label="Project stage journey"
            />
          </CardPad>
        </Card>

        {/* Next actions — wrapped in RecordActionZone so the advance/decide verb is sticky
            on desktop (never below the fold per DESIGN.md §7 RecordActionZone molecule). */}
        <RecordActionZone>
        <Card>
          {/* N10 (OD-W5-C3-B): wrap CardHead in a focusable div; the focus moves here
              programmatically after an Advance/Lost transition so a keyboard/SR user is
              told what changed. tabIndex={-1} keeps it out of the natural tab order. */}
          <div ref={nextActionsHeadRef} tabIndex={-1} className="outline-none focus-visible:ring-0">
            <CardHead>Next actions</CardHead>
          </div>
          <CardPad className="flex flex-col gap-3">
            {!canTransition ? (
              // Denied (Finance·Engineer, §C): a clean read-only note in place of the action
              // cluster — never a wall of disabled buttons (rbac-visibility reading-rule 5).
              <GateNotice variant="ready">
                Pipeline managed by the project owner. You can review this project&rsquo;s stage and
                journey here; lifecycle changes are made by the project manager.
              </GateNotice>
            ) : (
              <>
            {isTerminal ? (
              projectStatusGroup(liveStatus as never) === 'lost' ? (
                <GateNotice variant="ready">
                  This project is marked lost. It has left the active pipeline.
                </GateNotice>
              ) : (
                <GateNotice variant="ready">
                  This project has reached a terminal stage. No further pipeline actions.
                </GateNotice>
              )
            ) : (
              <GateNotice variant="ready">Ready to advance.</GateNotice>
            )}

            {/* Action hierarchy: exactly ONE solid blue (Advance — the primary path); Mark won
                / Mark lost are quiet outlines distinguished by a leading status dot
                (color-not-only). The solid destructive fill appears ONLY inside the confirm. */}
            {!isTerminal && (
              <div className="flex flex-wrap gap-2">
                {nextStage && (
                  <Button variant="primary" disabled={pending} onClick={() => void runTransition(nextStage)}>
                    Advance to {NEXT_PIPELINE_LABEL[liveStatus] ?? nextStage}
                  </Button>
                )}
                {canWin && (
                  <Button variant="outline" disabled={pending} onClick={() => setShowWonPanel((v) => !v)}>
                    <span aria-hidden className="size-1.5 rounded-full bg-success" />
                    Mark won
                  </Button>
                )}
                {canLose && (
                  <Button variant="outline" disabled={pending} onClick={() => setConfirmAction('lost')}>
                    <span aria-hidden className="size-1.5 rounded-full bg-destructive" />
                    Mark lost
                  </Button>
                )}
              </div>
            )}

            {/* Inline progressive SoD capture panel (no modal). */}
            {showWonPanel && canWin && (
              <div className="flex flex-col gap-3 rounded-md border border-border bg-secondary/40 p-3">
                <div className="text-[12px] font-semibold text-muted-foreground">
                  Record the won deal
                </div>
                {/* Confirm against the money (AC-IXD-DASH-005): restate the value being booked to
                    contract value on win, above the capture inputs. */}
                <div className="text-[13px] text-foreground">
                  Booking <strong className="font-semibold tabular">{formatCurrency(value)}</strong>{' '}
                  to contract value on win
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="won-ref" className="text-[12px] font-semibold">
                    Customer contract reference
                  </label>
                  <input
                    id="won-ref"
                    value={contractRef}
                    onChange={(e) => {
                      setContractRef(e.target.value);
                      setRefError(null);
                    }}
                    aria-invalid={!!refError}
                    aria-describedby={refError ? 'won-ref-err' : undefined}
                    placeholder="e.g. CPO-2026-0042"
                    className={`h-8 rounded-md border bg-background px-2.5 text-[13.5px] outline-none placeholder:text-muted-foreground ${
                      refError ? 'border-destructive' : 'border-input'
                    }`}
                  />
                  {refError && (
                    <span id="won-ref-err" className="text-[12px] text-destructive">
                      {refError}
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="won-date" className="text-[12px] font-semibold">
                    Contract date
                  </label>
                  <input
                    id="won-date"
                    type="date"
                    value={contractDate}
                    onChange={(e) => {
                      setContractDate(e.target.value);
                      setDateError(null);
                    }}
                    aria-invalid={!!dateError}
                    aria-describedby={dateError ? 'won-date-err' : undefined}
                    className={`h-8 rounded-md border bg-background px-2.5 text-[13.5px] outline-none ${
                      dateError ? 'border-destructive' : 'border-input'
                    }`}
                  />
                  {dateError && (
                    <span id="won-date-err" className="text-[12px] text-destructive">
                      {dateError}
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button variant="primary" size="sm" loading={pending} onClick={submitWon}>
                    Confirm won
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setShowWonPanel(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {error && (
              <div role="alert" className="flex items-start gap-2 text-[13px] text-destructive">
                <Icon name="alert" className="mt-px size-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
              </>
            )}

            {/* N10 (OD-W5-C3-B): persistent quiet "Back to Sales Pipeline" wayfinding link —
                always present in the Next-actions card so after any Advance the user has an
                obvious exit without it competing with the primary Advance CTA. On terminal
                transitions (Lost) it is the primary remaining affordance. One-Blue-compliant:
                a text link (not a solid button). Keyboard-reachable via standard focus order.
                Uses a plain <a> (not react-router Link) so the component mounts outside a
                Router context without breaking (the Sales route is a top-level navigation). */}
            <a
              href="/sales"
              className="mt-1 self-start text-[12.5px] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            >
              ← Back to Sales Pipeline
            </a>
          </CardPad>
        </Card>
        </RecordActionZone>
      </div>

      {/* Forward Advance has no confirm (OD-UX-1): it commits on a single click + a toast
          (see the Advance button above). Only the terminal Mark-lost confirms. */}

      {/* Mark lost: destructive modal (the only solid destructive fill). */}
      <ConfirmDialog
        open={canTransition && confirmAction === 'lost'}
        tone="destructive"
        title="Mark project as lost"
        description={`This moves ${project.name} to a terminal lost stage. You can still review it, but it will leave the active pipeline.`}
        confirmLabel="Mark lost"
        loading={pending}
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => void runTransition('Loss Tender')}
      />
    </div>
  );
};

export default PipelineLens;
