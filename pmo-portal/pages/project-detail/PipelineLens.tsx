import TaxBasisLabel from '@/src/components/ui/TaxBasisLabel';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
import {
  Button,
  LifecycleStepper,
  GateNotice,
  Icon,
  ConfirmDialog,
  RecordActionZone,
  useToast,
  type StatTile,
} from '@/src/components/ui';
import { useProjectWinEligibility } from '@/src/hooks/useProjectTransitions';
import { invalidateProjectProjections } from '@/src/hooks/projectQueryKeys';
import { useSalesPipeline } from '@/src/hooks/useDashboard';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { useIsDesktop } from '@/src/components/ui/useIsDesktop';
import { listReturnNavigation } from '@/src/lib/listReturnContext';
import { formatCurrency, formatDecisionDateNumeric } from '@/src/lib/format';
import {
  LEGAL_PROJECT_TRANSITIONS,
  PIPELINE_STATUSES,
  projectStatusGroup,
  type TransitionProjectOpts,
} from '@/src/lib/db/projectTransitions';
import { LostReasonFields, type LostReasonValue } from '@/components/project-status/LostReasonFields';
import { lostReasonValid, lostReasonLabel } from '@/src/lib/lostReasons';
import {
  weightedValue,
  formatPercent,
  dealJourneySteps,
} from '../../components/salesPipeline';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { repositories } from '@/src/lib/repositories';
import { synchronizeErpProject } from '@/src/lib/repositories/projectErpSetup';

// ⛔ NOT TRANSLATED, deliberately: these are pipeline STAGE names -- the same vocabulary
// class as the raw `project.status` rendered in the StatusPill beside them, and as
// `dealJourneySteps` in components/salesPipeline. Translating them here alone would put
// two languages on one screen. Belongs with the cross-cutting status-vocabulary decision.
const NEXT_PIPELINE_LABEL: Record<string, string> = {
  Leads: 'Pre-Qual',
  'PQ Submitted': 'Quotation',
  'Quotation Submitted': 'Tender',
  'Tender Submitted': 'Negotiation',
};

export interface PipelineLensProps {
  /** The canonical project/opportunity row (the active detail record). */
  project: ProjectWithRefs;
  /**
   * The owning route's `location.state` (list-working-set-return, #682, FR-LRC-006). Read ONLY
   * to resolve the quiet Sales Pipeline link's destination via `listReturnNavigation(…, 'sales')`
   * — a captured Sales context (only a Sales Pipeline open stamps one; see `canCaptureFromList`)
   * targets that same filtered Sales URL, otherwise the link falls back to bare `/sales`. Passed
   * down rather than read via `useLocation()` here so this component keeps rendering standalone
   * outside a Router (several tests mount it without one).
   */
  locationState?: unknown;
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
const PipelineLens: React.FC<PipelineLensProps> = ({ project, locationState }) => {
  const { t } = useTranslation('project');
  const { toast } = useToast();
  const { currentUser } = useAuth();
  const queryClient = useQueryClient();
  const may = usePermission();
  const isDesktop = useIsDesktop();

  // A-1 (rbac-visibility §B2): pipeline lifecycle control (Advance / Mark won / Mark lost) is
  // a delivery-led, PM-owned write — Admin·Exec·PM (`edit` on project). Finance·Engineer are
  // read-only on the pipeline lens (§C). The gate reads the REAL JWT role (ADR-0016); RLS/RPC
  // stays the authority — a denied role sees a clean read-only note, not dead buttons.
  const canTransition = may('edit', 'project');

  const {
    data: pipeline,
    isPending: isPipelinePending,
    isError: isPipelineError,
    refetch: refetchPipeline,
  } = useSalesPipeline();

  const liveStatus = project.status as string;
  // The pipeline projection carries win_probability; the project row carries the value.
  const cached = pipeline?.projects.find((p) => p.id === project.id);

  // N10 (OD-W5-C3-B): focus management after a transition — refs for the heading
  // of the Next-actions card (Advance/Lost) and the page header h1 (Won, where the
  // page becomes the delivery layout). A keyboard/SR user is told what changed.
  const nextActionsHeadRef = useRef<HTMLDivElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  // The post-Won focus defer must not fire after unmount (a torn-down page has no document to focus).
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (focusTimerRef.current) clearTimeout(focusTimerRef.current); }, []);

  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Write policy (OD-UX-1): a routine reversible forward Advance is SINGLE-CLICK + a toast
  // (no modal) — aligned to procurement + Tasks. Only the terminal/destructive `Mark lost`
  // opens a destructive confirm; `Mark won` keeps its inline SoD capture (that consequential
  // capture IS the confirm).
  const [confirmAction, setConfirmAction] = useState<'lost' | 'declined' | null>(null);
  const [lost, setLost] = useState<LostReasonValue>({ reason: '', note: '' });
  useEffect(() => { setLost({ reason: '', note: '' }); }, [confirmAction]);
  const [showWonPanel, setShowWonPanel] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const showDetails = isDesktop || detailsOpen;
  const [contractRef, setContractRef] = useState('');
  const [contractDate, setContractDate] = useState('');
  const [refError, setRefError] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);

  const legalTargets = useMemo(
    () => LEGAL_PROJECT_TRANSITIONS[liveStatus] ?? [],
    [liveStatus],
  );
  const winIsLegal = legalTargets.includes('Won, Pending KoM');
  const winEligibility = useProjectWinEligibility(project.id, canTransition && winIsLegal, project.contract_value_set_at);
  const canWin = canTransition && winIsLegal && winEligibility.data === 'allowed' && !winEligibility.isPending && !winEligibility.isFetching && !winEligibility.isError;
  const winReason = canTransition && winIsLegal && (winEligibility.isPending || winEligibility.isFetching)
    ? t('winEligibility.checking', 'Checking win eligibility…')
    : canTransition && winIsLegal && winEligibility.isError
    ? t('winEligibility.unavailable', 'Win eligibility is unavailable. Refresh this page and try again.')
    : canTransition && winIsLegal && winEligibility.data && winEligibility.data !== 'allowed'
    ? winEligibility.data === 'unavailable'
      ? t('winEligibility.unavailable', 'Win eligibility is unavailable. Refresh this page and try again.')
      : winEligibility.data === 'inactive_reviewer'
      ? t('winEligibility.inactive', 'Ask an active supervisor or a more senior reviewer to confirm the value.')
      : t('winEligibility.reviewer', 'Ask your supervisor or a more senior reviewer to confirm the value before winning this project.')
    : null;
  const canLose = legalTargets.includes('Loss Tender');
  const canDecline = legalTargets.includes('Declined');
  const nextStage = legalTargets.find((t) => PIPELINE_STATUSES.includes(t));
  const isTerminal = projectStatusGroup(liveStatus as never) !== 'pipeline';

  const value = project.contract_value ?? cached?.contract_value ?? 0;
  // FR-L10N-020: this lens shows ONE project's own money, so it uses that project's currency —
  // ProjectWithRefs carries the column (0187). No org fallback: a per-record figure rendered in the
  // org's denomination is the silent wrong number this seam exists to remove.
  const currency = project.currency;
  const canSeeMoney = may('view', 'salesInvoice');

  const renderTileUnavailable = () => (
    <span className="inline-flex items-center gap-1.5 text-sm font-normal text-muted-foreground">
      {t('projectDetail.pipeline.statUnavailable', 'Unavailable')}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void refetchPipeline()}
      >
        {t('projectDetail.pipeline.retry', 'Retry')}
      </Button>
    </span>
  );

  const winProbNode: React.ReactNode = isPipelinePending ? (
    <span className="text-sm font-normal text-muted-foreground">
      {t('projectDetail.pipeline.statLoading', 'Loading…')}
    </span>
  ) : isPipelineError || !cached ? (
    renderTileUnavailable()
  ) : (
    formatPercent(cached.win_probability)
  );

  const weightedValueNode: React.ReactNode = isPipelinePending ? (
    <span className="text-sm font-normal text-muted-foreground">
      {t('projectDetail.pipeline.statLoading', 'Loading…')}
    </span>
  ) : isPipelineError || !cached ? (
    renderTileUnavailable()
  ) : (
    formatCurrency(weightedValue(cached), currency)
  );

  const runTransition = async (
    to: string,
    opts?: TransitionProjectOpts,
  ) => {
    setError(null);
    setPending(true);
    try {
      // Preserve the RPC contract byte-for-byte: only the win and loss paths carry opts.
      if (opts) await repositories.project.transition(project.id, to as never, opts);
      else await repositories.project.transition(project.id, to as never);
      // AC-SETUP-001: a native win stays successful; ERP linking is a separate, retryable step.
      const erpPending =
        to === 'Won, Pending KoM' &&
        (await synchronizeErpProject(project.id, currentUser?.org_id)) === 'pending';
      await queryClient.invalidateQueries({ queryKey: ['integrations', 'project-erp', currentUser?.org_id] });
      await queryClient.invalidateQueries({ queryKey: ['integrations', 'setup', currentUser?.org_id] });
      await queryClient.invalidateQueries({ queryKey: ['sales-pipeline', currentUser?.org_id] });
      await queryClient.invalidateQueries({ queryKey: ['projects', currentUser?.org_id] });
      await queryClient.invalidateQueries({ queryKey: ['project', currentUser?.org_id, project.id] });
      await queryClient.invalidateQueries({ queryKey: ['opportunity', currentUser?.org_id, project.id] });
      invalidateProjectProjections(queryClient, currentUser?.org_id);
      setShowWonPanel(false);
      setContractRef('');
      setContractDate('');
      setConfirmAction(null);
      toast(
        t('projectDetail.pipeline.toast.updated', 'Project updated'),
        erpPending
          ? t('projectDetail.erpLink.movedPending', 'Moved to {{status}}. ERP linking needs attention; retry from the project page.', { status: to })
          : `${t('projectDetail.pipeline.toast.movedTo', 'Moved to')} ${to}`,
        erpPending ? 'warning' : 'success',
      );
      // N10 (OD-W5-C3-B): post-transition focus management. On Won the page re-renders
      // into the delivery layout; move focus to the page h1. On Advance/Lost move focus
      // to the Next-actions card heading so a keyboard/SR user is told what changed.
      if (to === 'Won, Pending KoM') {
        // Brief defer so the re-render (delivery header mounting) can complete first.
        focusTimerRef.current = setTimeout(() => {
          const h1 = document.querySelector<HTMLElement>('h1');
          h1?.focus();
        }, 80);
      } else {
        if (!isDesktop) {
          if (detailsRef.current) detailsRef.current.open = true;
          setDetailsOpen(true);
        }
        nextActionsHeadRef.current?.focus();
      }
    } catch (err) {
      // Surface the RPC error verbatim — it carries the P0001 SoD message.
      // Close the confirm so the verbatim error reads in the inline alert.
      setConfirmAction(null);
      setError(
        err instanceof Error
          ? err.message
          : t('projectDetail.pipeline.transitionFailed', 'Transition failed'),
      );
    } finally {
      setPending(false);
    }
  };

  const submitWon = () => {
    if (!canWin) return;
    const refMissing = !contractRef.trim();
    const dateMissing = !contractDate;
    setRefError(
      refMissing
        ? t('projectDetail.pipeline.refRequired', 'Customer contract reference is required')
        : null,
    );
    setDateError(
      dateMissing ? t('projectDetail.pipeline.dateRequired', 'Contract date is required') : null,
    );
    if (refMissing || dateMissing) return;
    void runTransition('Won, Pending KoM', {
      customerContractRef: contractRef.trim(),
      contractDate,
    });
  };

  const valueTile: StatTile = {
    label: t('projectDetail.pipeline.stat.value', 'Value'),
    value: formatCurrency(value, currency),
    // OD-TAX-1 §2: this is the figure that BECOMES the drawdown ceiling on win, so it states its
    // basis like every other money figure. The row carries it — OPPORTUNITY_COLUMNS includes
    // tax_treatment precisely for this (opportunity.ts). The pipeline LIST is a fair omission
    // (its RPC doesn't project the column, #578); this lens is not.
    sub: <TaxBasisLabel treatment={project.tax_treatment} taxRate={project.tax_rate} taxBaseNumerator={project.tax_base_numerator} taxBaseDenominator={project.tax_base_denominator} />,
  };
  const ownerTile: StatTile = {
    label: t('projectDetail.pipeline.stat.owner', 'Owner'),
    value: project.pm?.full_name ?? t('projectDetail.pipeline.notSet', 'Not set'),
  };
  // SUB-I: an open deal shows what is still in play (probability, weighted value); a decided deal shows
  // the decision instead — never a 0% win probability or a zero weighted value.
  const stats: StatTile[] = isTerminal
    ? [
        ...(canSeeMoney ? [valueTile] : []),
        ownerTile,
        {
          label: t('projectDetail.pipeline.stat.decision', 'Decision'),
          // A revived deal (Loss Tender -> Negotiation) keeps its old loss decided_at; it is undecided again.
          value: project.contract_date || ((project.status === 'Loss Tender' || project.status === 'Declined') && project.decided_at)
            ? formatDecisionDateNumeric(project)
            : t('projectDetail.pipeline.pending', 'Pending'),
        },
        ...((project.status === 'Loss Tender' || project.status === 'Declined')
          ? [
              {
                label: t('lostReason:deal.label', 'Lost reason'),
                value: lostReasonLabel((k, d) => String(t(k, d)), project.lost_reason),
              },
            ]
          : []),
      ]
    : [
        ...(canSeeMoney ? [valueTile] : []),
        { label: t('projectDetail.pipeline.stat.winProbability', 'Win probability'), value: winProbNode },
        ...(canSeeMoney ? [{ label: t('projectDetail.pipeline.stat.weighted', 'Weighted'), value: weightedValueNode }] : []),
        ownerTile,
      ];

  const projectJourney = (
    <section className="min-w-0 space-y-3 border-b border-border pb-4 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-5">
      <h2 className="text-sm font-semibold text-foreground">{t('projectDetail.pipeline.journeyHeading', 'Project journey')}</h2>
      <LifecycleStepper
        variant="bar"
        steps={dealJourneySteps(liveStatus as never)}
        aria-label={t('projectDetail.pipeline.journeyAriaLabel', 'Project stage journey')}
        className="[&_span]:text-xs"
      />
    </section>
  );

  return (
    <div className="min-w-0">
      {!isDesktop && <div className="mb-4 space-y-3 md:hidden">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{t('projectDetail.pipeline.currentStage', 'Current stage')}</p>
          <h2 className="text-base font-semibold text-foreground">{project.status}</h2>
        </div>
        {!canTransition ? (
          <p className="line-clamp-1 text-sm text-muted-foreground">{t('projectDetail.pipeline.readOnlyShort', 'Project manager manages this pipeline.')}</p>
        ) : !isTerminal && nextStage ? (
          <Button variant="primary" disabled={pending} onClick={() => void runTransition(nextStage)}>
            {`${t('projectDetail.pipeline.advanceTo', 'Advance to')} ${NEXT_PIPELINE_LABEL[liveStatus] ?? nextStage}`}
          </Button>
        ) : !isTerminal && canWin ? (
          <Button variant="primary" disabled={pending} onClick={() => {
            setShowWonPanel(true);
            if (detailsRef.current) detailsRef.current.open = true;
            setDetailsOpen(true);
          }}>
            {t('projectDetail.pipeline.markWon', 'Mark won')}
          </Button>
        ) : null}
        {canTransition && !detailsOpen && winReason && <p role="status" className="text-sm text-muted-foreground">{winReason}</p>}
      </div>}

      {!isDesktop && projectJourney}

      <details ref={detailsRef} open={isDesktop || detailsOpen} onToggle={(event) => setDetailsOpen(event.currentTarget.open)} className="min-w-0">
        <summary className="mb-4 cursor-pointer text-sm font-semibold text-foreground md:hidden">
          {t('projectDetail.pipeline.moreAboutDeal', 'More about this deal')}
        </summary>
        {showDetails && <>
          {stats.length > 0 && (
            <>
              <dl className="mb-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                {stats.map((tile, index) => (
                  <div key={index} className="min-w-0 border-b border-border pb-2">
                    <dt className="text-xs text-muted-foreground">{tile.label}</dt>
                    <dd className="mt-1 break-words text-base font-semibold tabular-nums text-foreground">{tile.value}</dd>
                    {tile.sub && <dd className="mt-1 text-xs text-muted-foreground">{tile.sub}</dd>}
                  </div>
                ))}
              </dl>
              {(project.status === 'Loss Tender' || project.status === 'Declined') && project.lost_note && (
                <p data-testid="lost-note" className="-mt-2 mb-4 text-xs text-muted-foreground">
                  {project.lost_note}
                </p>
              )}
            </>
          )}

        <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-2">
          {isDesktop && projectJourney}

          <section className="min-w-0 space-y-3">
            <div ref={nextActionsHeadRef} tabIndex={-1} className="outline-none focus-visible:ring-0">
              <h2 className="text-sm font-semibold text-foreground">{t('projectDetail.pipeline.nextActionsHeading', 'Next actions')}</h2>
            </div>
            {!canTransition ? (
              <GateNotice variant="ready">
                {t(
                  'projectDetail.pipeline.readOnlyNotice',
                  'Pipeline managed by the project owner. You can review this project’s stage and journey here; lifecycle changes are made by the project manager.',
                )}
              </GateNotice>
            ) : (
              <>
                {isTerminal ? (
                  projectStatusGroup(liveStatus as never) === 'lost' ? (
                    <GateNotice variant="ready">
                      {t('projectDetail.pipeline.lostNotice', 'This project is marked lost. It has left the active pipeline.')}
                    </GateNotice>
                  ) : (
                    <GateNotice variant="ready">
                      {t('projectDetail.pipeline.terminalNotice', 'This project has reached a terminal stage. No further pipeline actions.')}
                    </GateNotice>
                  )
                ) : null}

                {!isTerminal && (
                  <RecordActionZone>
                    {winReason && <p role="status" className="text-sm text-muted-foreground">{winReason}</p>}
                    <div className="flex flex-wrap gap-2">
                      {isDesktop && nextStage && (
                        <Button variant="primary" disabled={pending} onClick={() => void runTransition(nextStage)}>
                          {`${t('projectDetail.pipeline.advanceTo', 'Advance to')} ${NEXT_PIPELINE_LABEL[liveStatus] ?? nextStage}`}
                        </Button>
                      )}
                      {canWin && (
                        <Button variant="outline" disabled={pending} onClick={() => setShowWonPanel((v) => !v)}>
                          <span aria-hidden className="size-1.5 rounded-full bg-success" />
                          {t('projectDetail.pipeline.markWon', 'Mark won')}
                        </Button>
                      )}
                      {canLose && (
                        <Button variant="outline" disabled={pending} onClick={() => setConfirmAction('lost')}>
                          <span aria-hidden className="size-1.5 rounded-full bg-destructive" />
                          {t('projectDetail.pipeline.markLost', 'Mark lost')}
                        </Button>
                      )}
                      {canDecline && (
                        <Button variant="outline" disabled={pending} onClick={() => setConfirmAction('declined')}>
                          <span aria-hidden className="size-1.5 rounded-full bg-muted-foreground" />
                          {t('projectDetail.pipeline.markDeclined', 'Decline to bid')}
                        </Button>
                      )}
                    </div>
                  </RecordActionZone>
                )}

                {showWonPanel && canWin && (
                  <section className="flex flex-col gap-3 border-t border-border pt-3">
                    <div className="text-xs font-semibold text-muted-foreground">
                      {t('projectDetail.pipeline.recordWonHeading', 'Record the won project')}
                    </div>
                    <div className="text-[13px] text-foreground">
                      <Trans
                        i18nKey="projectDetail.pipeline.bookingOnWin"
                        defaults="Booking <1>{{amount}}</1> <3></3> to contract value on win"
                        values={{ amount: formatCurrency(value, currency) }}
                        components={{
                          1: <strong className="font-semibold tabular" />,
                          3: <TaxBasisLabel treatment={project.tax_treatment} taxRate={project.tax_rate} taxBaseNumerator={project.tax_base_numerator} taxBaseDenominator={project.tax_base_denominator} />,
                        }}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label htmlFor="won-ref" className="text-xs font-semibold">{t('projectDetail.pipeline.contractRefLabel', 'Customer contract reference')}</label>
                      <input id="won-ref" value={contractRef} onChange={(e) => { setContractRef(e.target.value); setRefError(null); }} aria-invalid={!!refError} aria-describedby={refError ? 'won-ref-err' : undefined} placeholder={t('projectDetail.pipeline.contractRefPlaceholder', 'e.g. CPO-2026-0042')} className={`h-8 rounded-md border bg-background px-2.5 text-[13.5px] outline-none placeholder:text-muted-foreground ${refError ? 'border-destructive' : 'border-input'}`} />
                      {refError && <span id="won-ref-err" className="text-xs text-destructive">{refError}</span>}
                    </div>
                    <div className="flex flex-col gap-1">
                      <label htmlFor="won-date" className="text-xs font-semibold">{t('projectDetail.pipeline.contractDateLabel', 'Contract date')}</label>
                      <input id="won-date" type="date" value={contractDate} onChange={(e) => { setContractDate(e.target.value); setDateError(null); }} aria-invalid={!!dateError} aria-describedby={dateError ? 'won-date-err' : undefined} className={`h-8 rounded-md border bg-background px-2.5 text-[13.5px] outline-none ${dateError ? 'border-destructive' : 'border-input'}`} />
                      {dateError && <span id="won-date-err" className="text-xs text-destructive">{dateError}</span>}
                    </div>
                    <div className="flex gap-2">
                      <Button variant="primary" size="sm" loading={pending} onClick={submitWon}>{t('projectDetail.pipeline.confirmWon', 'Confirm won')}</Button>
                      <Button variant="ghost" size="sm" onClick={() => setShowWonPanel(false)}>{t('projectDetail.pipeline.cancel', 'Cancel')}</Button>
                    </div>
                  </section>
                )}

                {error && (
                  <div role="alert" className="flex items-start gap-2 text-[13px] text-destructive">
                    <Icon name="alert" className="mt-px size-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}
              </>
            )}

            <Link
              to={listReturnNavigation(locationState, 'sales').path}
              state={listReturnNavigation(locationState, 'sales').state}
              className="mt-1 inline-flex text-xs font-semibold text-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            >
              {t('projectDetail.pipeline.backToSalesPipeline', '← Back to Sales Pipeline')}
            </Link>
          </section>
        </div>
        </>}
      </details>


      {/* Forward Advance has no confirm (OD-UX-1): it commits on a single click + a toast
          (see the Advance button above). Only the terminal Mark-lost confirms. */}

      {/* Mark lost: destructive modal (the only solid destructive fill). */}
      <ConfirmDialog
        open={canTransition && confirmAction === 'lost'}
        tone="destructive"
        title={t('projectDetail.pipeline.lostConfirm.title', 'Mark project as lost')}
        description={
          <>
            <p>
              {t(
                'projectDetail.pipeline.lostConfirm.body',
                'This moves {{project}} to a terminal lost stage. You can still review it, but it will leave the active pipeline.',
                { project: project.name },
              )}
            </p>
            <LostReasonFields idPrefix="lens" value={lost} onChange={setLost} />
          </>
        }
        confirmLabel={t('projectDetail.pipeline.lostConfirm.confirm', 'Mark lost')}
        confirmDisabled={!lostReasonValid(lost.reason, lost.note)}
        loading={pending}
        onCancel={() => setConfirmAction(null)}
        onConfirm={() =>
          void runTransition('Loss Tender', {
            lostReason: lost.reason,
            lostNote: lost.note.trim() || undefined,
          })
        }
      />

      {/* Decline to bid (#774): terminal pre-award outcome, kept out of win-rate denominators. */}
      <ConfirmDialog
        open={canTransition && confirmAction === 'declined'}
        tone="destructive"
        title={t('projectDetail.pipeline.declinedConfirm.title', 'Decline to bid')}
        description={
          <>
            <p>
              {t(
                'projectDetail.pipeline.declinedConfirm.body',
                'This records {{project}} as declined: we chose not to bid. It leaves the active pipeline and is not counted against the win rate.',
                { project: project.name },
              )}
            </p>
            <LostReasonFields idPrefix="lens" value={lost} onChange={setLost} />
          </>
        }
        confirmLabel={t('projectDetail.pipeline.declinedConfirm.confirm', 'Decline to bid')}
        confirmDisabled={!lostReasonValid(lost.reason, lost.note)}
        loading={pending}
        onCancel={() => setConfirmAction(null)}
        onConfirm={() =>
          void runTransition('Declined', {
            lostReason: lost.reason,
            lostNote: lost.note.trim() || undefined,
          })
        }
      />
    </div>
  );
};

export default PipelineLens;
