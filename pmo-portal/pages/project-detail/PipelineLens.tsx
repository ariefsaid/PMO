import TaxBasisLabel from '@/src/components/ui/TaxBasisLabel';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Card,
  CardHead,
  CardPad,
  Button,
  LifecycleStepper,
  GateNotice,
  RecordActionZone,
  Icon,
  ConfirmDialog,
  useToast,
} from '@/src/components/ui';
import { useSalesStageLabel } from '@/src/hooks/useProjectStatusLabel';
import { useSalesPipeline } from '@/src/hooks/useDashboard';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { listReturnNavigation } from '@/src/lib/listReturnContext';
import { formatDecisionDateNumeric, formatNumberExact, formatShortMoney } from '@/src/lib/format';
import {
  transitionProject,
  LEGAL_PROJECT_TRANSITIONS,
  PIPELINE_STATUSES,
  projectStatusGroup,
} from '@/src/lib/db/projectTransitions';
import {
  SALES_COLUMNS,
  weightedValue,
  formatPercent,
  dealJourneySteps,
} from '../../components/salesPipeline';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { synchronizeErpProject } from '@/src/lib/repositories/projectErpSetup';

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
  /** When supplied, the forward transition is rendered in the shared record heading slot. */
  onPrimaryActionChange?: (action: PipelinePrimaryAction | null) => void;
  /** Router-backed return used by the canonical record route to restore list scroll state. */
  onReturnToSales?: () => void;
}

export interface PipelinePrimaryAction {
  label: string;
  disabled: boolean;
  activate: () => void;
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
const PipelineLens: React.FC<PipelineLensProps> = ({ project, locationState, onPrimaryActionChange, onReturnToSales }) => {
  const { t } = useTranslation();
  const { t: salesT } = useTranslation('sales');
  const salesStageLabel = useSalesStageLabel();
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
  const canDecline = legalTargets.includes('Declined');
  const nextStage = legalTargets.find((target) => PIPELINE_STATUSES.indexOf(target) > PIPELINE_STATUSES.indexOf(liveStatus));
  const nextStageLabel = nextStage ? salesStageLabel(SALES_COLUMNS.find((column) => column.statuses.includes(nextStage)) ?? { title: nextStage, testId: '' }) : '';
  const isTerminal = projectStatusGroup(liveStatus as never) !== 'pipeline';

  const value = project.contract_value ?? cached?.contract_value ?? 0;
  // FR-L10N-020: this lens shows ONE project's own money, so it uses that project's currency —
  // ProjectWithRefs carries the column (0187). No org fallback: a per-record figure rendered in the
  // org's denomination is the silent wrong number this seam exists to remove.
  const currency = project.currency;
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

  const runTransitionRef = useRef(runTransition);
  runTransitionRef.current = runTransition;
  useEffect(() => {
    if (!onPrimaryActionChange) return;
    if (!canTransition || !nextStage || isTerminal || showWonPanel || confirmAction) {
      onPrimaryActionChange(null);
      return;
    }
    onPrimaryActionChange({
      label: `${t('projectDetail.pipeline.advanceTo', 'Advance to')} ${nextStageLabel}`,
      disabled: pending,
      activate: () => { void runTransitionRef.current(nextStage); },
    });
  }, [canTransition, confirmAction, isTerminal, liveStatus, nextStage, onPrimaryActionChange, pending, nextStageLabel, showWonPanel, t]);
  useEffect(() => () => onPrimaryActionChange?.(null), [onPrimaryActionChange]);

  const submitWon = () => {
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

  const contractValueBlock = (
    <section data-testid="pipeline-contract-value" className="mb-8 min-w-0" aria-label={salesT('pipeline.opportunityValue', 'Opportunity value')}>
      <h2 className="flex flex-wrap items-baseline gap-x-2 text-xl font-bold leading-tight tracking-[-0.01em]">
        <span>{salesT('pipeline.opportunityValue', 'Opportunity value')} ·</span>
        <span className="tabular">{showWonPanel ? `${currency} ${formatNumberExact(value)}` : formatShortMoney(value, currency, { code: true })}</span>
        <TaxBasisLabel treatment={project.tax_treatment} taxRate={project.tax_rate} taxBaseNumerator={project.tax_base_numerator} taxBaseDenominator={project.tax_base_denominator} showDetails={false} className="font-semibold" />
      </h2>
      {!showWonPanel && <dl className="mt-4 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4">
        <dt className="text-xs font-semibold text-muted-foreground">
          {salesT('pipeline.exactValue', 'Exact value')}
        </dt>
        <dd className="min-w-0 whitespace-nowrap text-right text-sm text-foreground tabular">
          {formatNumberExact(value)}
        </dd>
      </dl>}
    </section>
  );

  return (
    <div>
      {!showWonPanel && contractValueBlock}

      {!showWonPanel && (
        <section className="mb-8 min-w-0" aria-labelledby="pipeline-context-heading">
          <h2 id="pipeline-context-heading" className="text-xl font-bold leading-tight tracking-[-0.01em]">
            {isTerminal
              ? salesT('pipeline.decisionContext', 'Decision details')
              : `${salesT('pipeline.contextHeading', 'Pipeline context')} · ${currency}`}
          </h2>
          <dl className="mt-4 grid min-w-0 grid-cols-1 gap-y-2 [&>div]:grid [&>div]:grid-cols-[auto_minmax(0,1fr)] [&>div]:items-baseline [&>div]:gap-x-4 [&_dd]:text-right">
            {isTerminal ? (
              <>
                <div className="min-w-0">
                  <dt className="text-xs font-semibold text-muted-foreground">{t('projectDetail.pipeline.stat.owner', 'Owner')}</dt>
                  <dd className="mt-1 break-words text-sm">{project.pm?.full_name ?? t('projectDetail.pipeline.notSet', 'Not set')}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs font-semibold text-muted-foreground">{t('projectDetail.pipeline.stat.decision', 'Decision')}</dt>
                  <dd className="mt-1 break-words text-sm">
                    {project.contract_date || ((project.status === 'Loss Tender' || project.status === 'Declined') && project.decided_at)
                      ? formatDecisionDateNumeric(project)
                      : t('projectDetail.pipeline.pending', 'Pending')}
                  </dd>
                </div>
              </>
            ) : (
              <>
                <div className="min-w-0">
                  <dt className="text-xs font-semibold text-muted-foreground">{t('projectDetail.pipeline.stat.winProbability', 'Win probability')}</dt>
                  <dd className="mt-1 text-sm tabular">{formatPercent(winProb)}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs font-semibold text-muted-foreground">{t('projectDetail.pipeline.stat.weighted', 'Weighted')}</dt>
                  <dd className="mt-1 break-words text-sm tabular [overflow-wrap:anywhere]">{formatNumberExact(weighted)}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs font-semibold text-muted-foreground">{t('projectDetail.pipeline.stat.owner', 'Owner')}</dt>
                  <dd className="mt-1 break-words text-sm">{project.pm?.full_name ?? t('projectDetail.pipeline.notSet', 'Not set')}</dd>
                </div>
              </>
            )}
          </dl>
        </section>
      )}

      {/* AC-RAM-003 (#688): base grid-cols-1 (explicit, matches the stacked mobile intent) +
          min-w-0 on EACH grid item. Without it, a grid item's default min-width:auto falls back
          to its content-based minimum size — which, for the Journey card, is the LifecycleStepper's
          un-wrapped step row (flex, no wrap, summed children) — forcing the shared single-column
          track to that width and overflowing the viewport at phone width. min-w-0 lets the track
          shrink to the container's width; the stepper's own overflow-x-auto then scrolls instead. */}
      <div className="grid grid-cols-1 gap-8">
        {/* Opportunity journey */}
        {!showWonPanel && <Card className="min-w-0">
          <CardHead className="text-xl font-bold">{t('projectDetail.pipeline.journeyHeading', 'Project journey')}</CardHead>
          <CardPad>
            <LifecycleStepper
              variant="bar"
              className="[&_[role=list]]:!grid [&_[role=list]]:grid-cols-3 [&_[role=list]]:gap-4 [&_.jstep]:!min-w-0 [&_[data-testid=stepper-fade]]:hidden"
              steps={dealJourneySteps(liveStatus as never).map((step, index) => index < 5 ? { ...step, label: salesStageLabel(SALES_COLUMNS[index]) } : step)}
              aria-label={t('projectDetail.pipeline.journeyAriaLabel', 'Project stage journey')}
            />
          </CardPad>
        </Card>}

        {/* Next actions — wrapped in RecordActionZone so the advance/decide verb is sticky
            on desktop (never below the fold per DESIGN.md §7 RecordActionZone molecule). */}
        <RecordActionZone className="min-w-0">
        <Card>
          {/* N10 (OD-W5-C3-B): wrap CardHead in a focusable div; the focus moves here
              programmatically after an Advance/Lost transition so a keyboard/SR user is
              told what changed. tabIndex={-1} keeps it out of the natural tab order. */}
          <div ref={nextActionsHeadRef} tabIndex={-1} className="outline-none focus-visible:ring-0">
            <CardHead className="text-xl font-bold">{showWonPanel ? t('projectDetail.pipeline.recordWonHeading', 'Record the won project') : t('projectDetail.pipeline.nextActionsHeading', 'Next actions')}</CardHead>
          </div>
          <CardPad className="flex flex-col gap-3">
            {!canTransition ? (
              // Denied (Finance·Engineer, §C): a clean read-only note in place of the action
              // cluster — never a wall of disabled buttons (rbac-visibility reading-rule 5).
              <GateNotice variant="ready">
                {t(
                  'projectDetail.pipeline.readOnlyNotice',
                  'Pipeline managed by the project owner. You can review this project\u2019s stage and journey here; lifecycle changes are made by the project manager.',
                )}
              </GateNotice>
            ) : (
              <>
            {isTerminal ? (
              projectStatusGroup(liveStatus as never) === 'lost' ? (
                <GateNotice variant="ready">
                  {t(
                    'projectDetail.pipeline.lostNotice',
                    'This project is marked lost. It has left the active pipeline.',
                  )}
                </GateNotice>
              ) : (
                <GateNotice variant="ready">
                  {t(
                    'projectDetail.pipeline.terminalNotice',
                    'This project has reached a terminal stage. No further pipeline actions.',
                  )}
                </GateNotice>
              )
            ) : null}

            {/* Action hierarchy: exactly ONE solid blue (Advance — the primary path); Mark won
                / Mark lost are quiet outlines distinguished by a leading status dot
                (color-not-only). The solid destructive fill appears ONLY inside the confirm. */}
            {!isTerminal && !showWonPanel && (
              <div className="flex flex-wrap gap-2">
                {nextStage && !onPrimaryActionChange && (
                  <Button variant="primary" disabled={pending} onClick={() => void runTransition(nextStage)}>
                    {`${t('projectDetail.pipeline.advanceTo', 'Advance to')} ${
                      nextStageLabel
                    }`}
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
            )}

            {/* Inline progressive SoD capture panel (no modal). */}
            {showWonPanel && canWin && (
              <div className="flex flex-col gap-4">
                <div className="break-words text-sm">{project.name}</div>
                {contractValueBlock}
                <div className="text-sm text-muted-foreground">
                  {t('projectDetail.pipeline.bookingOnWin', 'This contract value is recorded when you confirm the win.')}
                </div>
                <p className="text-xs font-semibold text-muted-foreground">{salesT('pipeline.requiredFields', '* Required fields')}</p>
                <div className="flex flex-col gap-1">
                  <label htmlFor="won-ref" className="text-xs font-semibold">
                    {t('projectDetail.pipeline.contractRefLabel', 'Customer contract reference')} *
                  </label>
                  <input
                    id="won-ref"
                    aria-required="true"
                    value={contractRef}
                    onChange={(e) => {
                      setContractRef(e.target.value);
                      setRefError(null);
                    }}
                    aria-invalid={!!refError}
                    aria-describedby={refError ? 'won-ref-err' : undefined}
                    placeholder={t('projectDetail.pipeline.contractRefPlaceholder', 'e.g. CPO-2026-0042')}
                    autoFocus
                    className={`h-11 rounded-md border bg-background px-2.5 text-sm outline-none placeholder:text-muted-foreground ${
                      refError ? 'border-destructive' : 'border-input'
                    }`}
                  />
                  {refError && (
                    <span id="won-ref-err" className="text-xs font-semibold text-destructive">
                      {refError}
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="won-date" className="text-xs font-semibold">
                    {t('projectDetail.pipeline.contractDateLabel', 'Contract date')} *
                  </label>
                  <input
                    id="won-date"
                    aria-required="true"
                    type="date"
                    value={contractDate}
                    onChange={(e) => {
                      setContractDate(e.target.value);
                      setDateError(null);
                    }}
                    aria-invalid={!!dateError}
                    aria-describedby={dateError ? 'won-date-err' : undefined}
                    className={`h-11 rounded-md border bg-background px-2.5 text-sm outline-none ${
                      dateError ? 'border-destructive' : 'border-input'
                    }`}
                  />
                  {dateError && (
                    <span id="won-date-err" className="text-xs font-semibold text-destructive">
                      {dateError}
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button variant="primary" className="min-h-11 min-w-11" loading={pending} onClick={submitWon}>
                    {t('projectDetail.pipeline.confirmWon', 'Confirm won')}
                  </Button>
                  <Button variant="ghost" className="min-h-11 min-w-11" onClick={() => setShowWonPanel(false)}>
                    {t('projectDetail.pipeline.cancel', 'Cancel')}
                  </Button>
                </div>
              </div>
            )}

            {error && (
              <div role="alert" className="flex items-start gap-2 text-sm text-destructive">
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
                Router context without breaking (the Sales route is a top-level navigation).
                list-working-set-return (#682, FR-LRC-006): the href is the captured Sales list
                URL when this project was opened FROM a narrowed Sales Pipeline, otherwise the
                bare index — `listReturnNavigation` is the single validated resolver, same as
                the mobile BackBar / desktop breadcrumb elsewhere in the seam. */}
            {!onReturnToSales && <a
              href={listReturnNavigation(locationState, 'sales').path}
              onClick={onReturnToSales ? (event) => { event.preventDefault(); onReturnToSales(); } : undefined}
              className="mt-1 inline-flex min-h-11 min-w-11 items-center self-start text-sm text-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            >
              {t('projectDetail.pipeline.backToSalesPipeline', '\u2190 Back to Sales Pipeline')}
            </a>}
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
        title={t('projectDetail.pipeline.lostConfirm.title', 'Mark project as lost')}
        description={t(
          'projectDetail.pipeline.lostConfirm.body',
          'This moves {{project}} to a terminal lost stage. You can still review it, but it will leave the active pipeline.',
          { project: project.name },
        )}
        confirmLabel={t('projectDetail.pipeline.lostConfirm.confirm', 'Mark lost')}
        loading={pending}
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => void runTransition('Loss Tender')}
      />

      {/* Decline to bid (#774): terminal pre-award outcome, kept out of win-rate denominators. */}
      <ConfirmDialog
        open={canTransition && confirmAction === 'declined'}
        tone="destructive"
        title={t('projectDetail.pipeline.declinedConfirm.title', 'Decline to bid')}
        description={t(
          'projectDetail.pipeline.declinedConfirm.body',
          'This records {{project}} as declined: we chose not to bid. It leaves the active pipeline and is not counted against the win rate.',
          { project: project.name },
        )}
        confirmLabel={t('projectDetail.pipeline.declinedConfirm.confirm', 'Decline to bid')}
        loading={pending}
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => void runTransition('Declined')}
      />
    </div>
  );
};

export default PipelineLens;
