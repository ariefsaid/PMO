import React, { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Card,
  CardHead,
  CardPad,
  Button,
  StatTiles,
  LifecycleStepper,
  GateNotice,
  Icon,
  ConfirmDialog,
  useToast,
  type StatTile,
} from '@/src/components/ui';
import { useSalesPipeline } from '@/src/hooks/useDashboard';
import { useAuth } from '@/src/auth/useAuth';
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

  const { data: pipeline } = useSalesPipeline();

  const liveStatus = project.status as string;
  // The pipeline projection carries win_probability; the project row carries the value.
  const cached = pipeline?.projects.find((p) => p.id === project.id);

  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Confirm-before-write: forward Advance => default popover, Mark lost => destructive modal.
  // Mark won keeps its inline SoD panel (the consequential capture IS the confirm).
  const [confirmAction, setConfirmAction] = useState<'advance' | 'lost' | null>(null);
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
      toast('Deal updated', `Moved to ${to}`, 'success');
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
          <CardHead>Opportunity journey</CardHead>
          <CardPad>
            <LifecycleStepper
              variant="node"
              steps={dealJourneySteps(liveStatus as never)}
              aria-label="Deal stage journey"
            />
          </CardPad>
        </Card>

        {/* Next actions */}
        <Card>
          <CardHead>Next actions</CardHead>
          <CardPad className="flex flex-col gap-3">
            {isTerminal ? (
              <GateNotice variant="ready">
                This deal has reached a terminal stage. No further pipeline actions.
              </GateNotice>
            ) : (
              <GateNotice variant="ready">Ready to advance.</GateNotice>
            )}

            {/* Action hierarchy: exactly ONE solid blue (Advance — the primary path); Mark won
                / Mark lost are quiet outlines distinguished by a leading status dot
                (color-not-only). The solid destructive fill appears ONLY inside the confirm. */}
            {!isTerminal && (
              <div className="flex flex-wrap gap-2">
                {nextStage && (
                  <Button variant="primary" disabled={pending} onClick={() => setConfirmAction('advance')}>
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
          </CardPad>
        </Card>
      </div>

      {/* Forward Advance: lightweight default-tone confirm. */}
      {nextStage && (
        <ConfirmDialog
          open={confirmAction === 'advance'}
          tone="default"
          title={`Advance to ${NEXT_PIPELINE_LABEL[liveStatus] ?? nextStage}?`}
          description={`This moves ${project.name} forward to the ${NEXT_PIPELINE_LABEL[liveStatus] ?? nextStage} stage.`}
          confirmLabel={`Advance to ${NEXT_PIPELINE_LABEL[liveStatus] ?? nextStage}`}
          loading={pending}
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => void runTransition(nextStage)}
        />
      )}

      {/* Mark lost: destructive modal (the only solid destructive fill). */}
      <ConfirmDialog
        open={confirmAction === 'lost'}
        tone="destructive"
        title="Mark deal as lost"
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
