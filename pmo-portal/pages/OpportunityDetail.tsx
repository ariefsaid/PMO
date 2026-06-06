import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  PageHeader,
  Card,
  CardHead,
  CardPad,
  Button,
  StatusPill,
  LifecycleStepper,
  GateNotice,
  ListState,
  Icon,
  useToast,
  type PageStat,
} from '@/src/components/ui';
import { BackBar, useWorkspaceTabs } from '@/src/components/shell';
import { useSalesPipeline } from '@/src/hooks/useDashboard';
import { useOpportunity } from '@/src/lib/db/opportunity';
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
  pillVariantForStatus,
  formatPercent,
  dealJourneySteps,
  SALES_COLUMNS,
} from '../components/salesPipeline';

const NEXT_PIPELINE_LABEL: Record<string, string> = {
  Leads: 'Pre-Qual',
  'PQ Submitted': 'Quotation',
  'Quotation Submitted': 'Tender',
  'Tender Submitted': 'Negotiation',
};

function stageDot(status: string): string {
  const col = SALES_COLUMNS.find((c) => c.statuses.includes(status));
  return col?.dotColor ?? 'hsl(var(--muted-foreground))';
}

const OpportunityDetail: React.FC = () => {
  const { opportunityId = '' } = useParams<{ opportunityId: string }>();
  const ws = useWorkspaceTabs();
  const { toast } = useToast();
  const { currentUser } = useAuth();
  const queryClient = useQueryClient();

  const { data: pipeline, isPending: pipelinePending } = useSalesPipeline();
  const { data: opp, isPending: oppPending } = useOpportunity(opportunityId);

  // The index cache carries status/value/win_probability; the DAL adds the
  // richer detail fields. Prefer the cached pipeline row for the live status.
  const cached = pipeline?.projects.find((p) => p.id === opportunityId);
  const name = opp?.name ?? cached?.name ?? '';
  const status = (cached?.status ?? opp?.status) as string | undefined;

  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [showWonPanel, setShowWonPanel] = useState(false);
  const [contractRef, setContractRef] = useState('');
  const [contractDate, setContractDate] = useState('');
  const [refError, setRefError] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);

  // Hydrate the synthetic record tab's label to the human name once resolved.
  useEffect(() => {
    if (name && opportunityId) {
      ws.openRecord({
        id: `sales:${opportunityId}`,
        kind: 'record',
        path: `/sales/${opportunityId}`,
        icon: 'pipe',
        label: name,
        code: opp?.code ?? opportunityId,
        module: 'sales',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, opportunityId, opp?.code]);

  const legalTargets = useMemo(
    () => (status ? (LEGAL_PROJECT_TRANSITIONS[status] ?? []) : []),
    [status],
  );
  const canWin = legalTargets.includes('Won, Pending KoM');
  const canLose = legalTargets.includes('Loss Tender');
  const nextStage = legalTargets.find((t) => PIPELINE_STATUSES.includes(t));
  const isTerminal = status ? projectStatusGroup(status as never) !== 'pipeline' : false;

  const goBack = () => ws.openModule('sales');

  // ── States ─────────────────────────────────────────────────────────────────
  if (pipelinePending && oppPending) {
    return (
      <>
        <BackBar label="Sales Pipeline" onBack={goBack} />
        <ListState variant="loading" rows={6} />
      </>
    );
  }
  if (!name) {
    return (
      <>
        <BackBar label="Sales Pipeline" onBack={goBack} />
        <ListState
          variant="error"
          icon="inbox"
          title="Opportunity not found"
          sub="This deal does not exist or you don't have access to it."
        />
      </>
    );
  }

  const liveStatus = status as string;
  const value = opp?.contract_value ?? cached?.contract_value ?? 0;
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
      // exactly two args (no opts), only the Won path carries the SoD opts.
      if (opts) await transitionProject(opportunityId, to as never, opts);
      else await transitionProject(opportunityId, to as never);
      await queryClient.invalidateQueries({ queryKey: ['sales-pipeline', currentUser?.org_id] });
      await queryClient.invalidateQueries({ queryKey: ['opportunity', currentUser?.org_id, opportunityId] });
      setShowWonPanel(false);
      setContractRef('');
      setContractDate('');
      ws.setDirty(`sales:${opportunityId}`, false);
      toast('Deal updated', `Moved to ${to}`, 'success');
    } catch (err) {
      // Surface the RPC error verbatim — it carries the P0001 SoD message.
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

  const meta = [
    opp?.client?.name ?? cached?.client_name ?? null,
    opp?.code ? `· ${opp.code}` : null,
    opp?.customer_contract_ref ? `· ${opp.customer_contract_ref}` : null,
  ]
    .filter(Boolean)
    .join(' ');

  const stats: PageStat[] = [
    { label: 'Value', value: formatCurrency(value) },
    { label: 'Win probability', value: formatPercent(winProb) },
    { label: 'Weighted', value: formatCurrency(weighted) },
    { label: 'Owner', value: opp?.pm?.full_name ?? '—' },
    {
      label: 'Decision',
      value: opp?.decided_at ? new Date(opp.decided_at).toLocaleDateString() : '—',
    },
  ];

  return (
    <div>
      <BackBar label="Sales Pipeline" onBack={goBack} />
      <PageHeader
        icon={(name.trim().charAt(0) || '•').toUpperCase()}
        iconColor={stageDot(liveStatus)}
        name={name}
        status={<StatusPill variant={pillVariantForStatus(liveStatus as never)}>{liveStatus}</StatusPill>}
        meta={meta || undefined}
        stats={stats}
      />

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

            {!isTerminal && (
              <div className="flex flex-wrap gap-2">
                {nextStage && (
                  <Button variant="outline" disabled={pending} onClick={() => void runTransition(nextStage)}>
                    Advance to {NEXT_PIPELINE_LABEL[liveStatus] ?? nextStage}
                  </Button>
                )}
                {canWin && (
                  <Button variant="primary" disabled={pending} onClick={() => setShowWonPanel((v) => !v)}>
                    Mark won
                  </Button>
                )}
                {canLose && (
                  <Button
                    variant="destructive"
                    disabled={pending}
                    onClick={() => void runTransition('Loss Tender')}
                  >
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
                      ws.setDirty(`sales:${opportunityId}`, true);
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
                      ws.setDirty(`sales:${opportunityId}`, true);
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
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setShowWonPanel(false);
                      ws.setDirty(`sales:${opportunityId}`, false);
                    }}
                  >
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
    </div>
  );
};

export default OpportunityDetail;
