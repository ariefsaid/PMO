/**
 * AC-IXD-PROC-W5-2 / AC-RB-004..014 — DecisionSupportPanel
 *
 * A read-only budget-impact card placed in the evidence zone of ProcurementDetails,
 * directly under StatTiles. Renders ONLY when p.project_id is set AND the case status
 * is pre-Ordered (Draft..Quote Selected) — ADR-0034 §6.
 *
 * Three budget layers (ADR-0034):
 *   • Budget    = useProjectBudget(projectId) — Σ Active budget-version line items.
 *   • Committed = useProjectCommittedSpend(projectId) — Σ PO total_value in
 *                 Ordered/Received/Vendor Invoiced/Paid (the EXACT basis the dashboards
 *                 use, 0009_dashboard_margin.sql). UNCHANGED by this feature.
 *   • Reserved  = useProjectReservedSpend(projectId) — Σ total_value in Approved/Vendor
 *                 Quoted/Quote Selected (approved, not yet ordered — "encumbrance").
 * No new RPC — three focused org-scoped reads.
 *
 * Available = Budget − Committed − Reserved (the over-commitment-safe headroom).
 *
 * The five figures in ordinary procurement context (text-labelled, a11y: text-not-color-only per DESIGN.md §4):
 *   This request · Reserved (other) · Available · Project budget · After this request.
 * Approval previews can hide project/request identity already shown in their decision header.
 * Over-budget is a non-blocking advisory (approval still permitted — OD-W5-4/OD-W5-5).
 *
 * Per-stage "After this request" math (ADR-0034 §5 — the double-count fix): when the
 * viewed case is itself already in Reserved (status ∈ Approved/Vendor Quoted/Quote
 * Selected), its value is already inside `reserved`, so After == Available (do NOT
 * subtract thisRequest again). Otherwise (Draft/Requested) After = Available − thisRequest.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Card, CardPad } from '@/src/components/ui/Card';
import { ErrBanner } from '@/src/components/ui/ErrBanner';
import { ProjectNameLink } from '@/src/components/ui/ProjectNameLink';
import { useProjectBudget } from '@/src/hooks/useBudget';
import { useProjectCommittedSpend, useProjectReservedSpend } from '@/src/hooks/useProcurements';
import { usePermission } from '@/src/auth/usePermission';
import type { ProcurementStatus } from '@/src/lib/db/procurementLifecycle';
import { formatNumberWhole, formatNumberExact } from '@/src/lib/format';
import { computeBudgetSignal } from './computeBudgetSignal';

/** Pre-Ordered statuses where the panel is a live decision-support tool (ADR-0034 §6). */
const PANEL_VISIBLE_STATUSES: ProcurementStatus[] = [
  'Draft',
  'Requested',
  'Approved',
  'Vendor Quoted',
  'Quote Selected',
];

export interface DecisionSupportPanelProps {
  /** The procurement's project_id. Pass null/undefined to suppress the panel. */
  projectId: string | null | undefined;
  /** The procurement's total_value (this request's cost). */
  totalValue: number;
  /** Project display name (from DETAIL_SELECT join). */
  projectName: string | null | undefined;
  /** Contractual title behind a short `projectName`. */
  projectLegalName?: string | null;
  /** The case's current status — drives per-stage math + the visibility boundary. */
  status: ProcurementStatus;
  /** The procurement's own ISO-4217 currency (FR-L10N-020) — every figure here derives
   *  from `totalValue`/the project's budget rollups, which share this record's currency. */
  currency: string;
  /** Hide project identity when the surrounding approval header already names the project. */
  showProjectContext?: boolean;
  /** A surrounding decision group may already name the currency. */
  showCurrency?: boolean;
  /** Hide the request amount when the decision surface shows its own authoritative total. */
  showRequestValue?: boolean;
}

export const DecisionSupportPanel: React.FC<DecisionSupportPanelProps> = ({
  projectId,
  totalValue,
  projectName,
  projectLegalName,
  status,
  currency,
  showProjectContext = true,
  showRequestValue = true,
  showCurrency = true,
}) => {
  const { t } = useTranslation();
  // Committed and Reserved sum every request on the project. A role that reads only the requests it
  // raised (Engineer, migration 0350) would get a partial sum and an overstated Available, so the
  // panel is not offered to it and its reads are not issued.
  const may = usePermission();
  const readsProjectWideSpend = may('view', 'procurement');
  const scopedProjectId = readsProjectWideSpend ? projectId : null;

  // Hooks must be called unconditionally; all are no-ops (enabled:false) when
  // the project id is falsy, so the early returns below are safe.
  const budget = useProjectBudget(scopedProjectId ?? '');
  const committed = useProjectCommittedSpend(scopedProjectId);
  const reservedQ = useProjectReservedSpend(scopedProjectId);

  // Bail out — no project linked (takes precedence over the status gate, FR-RB-020),
  // or a viewer whose purchasing read is limited to their own requests.
  if (!scopedProjectId) return null;

  // Bail out — post-Ordered / terminal: the panel is a pre-decision tool only, and
  // hiding it here makes the legacy double-count path structurally impossible.
  if (!PANEL_VISIBLE_STATUSES.includes(status)) return null;

  const heading = (
    <div className="mb-3 flex items-baseline gap-1">
      <h3 className="text-xl font-bold text-foreground">
        {t('work:budgetImpact.title', 'Budget impact')}{showCurrency && ` · ${currency}`}
      </h3>
      {showProjectContext && projectName ? (
        <ProjectNameLink
          projectId={scopedProjectId}
          name={projectName}
          legalName={projectLegalName}
          className="text-sm font-normal text-foreground"
        />
      ) : null}
    </div>
  );

  const isPending = budget.isPending || committed.isPending || reservedQ.isPending;
  const isError = budget.isError || committed.isError || reservedQ.isError;

  // ── Loading state ──────────────────────────────────────────────────────────
  if (isPending) {
    return (
      <Card variant="bare" className="mb-4">
        <CardPad>
          {heading}
          <div className="flex flex-col gap-2" aria-label="Loading budget impact">
            <div className="skel h-[18px] w-3/4" />
            <div className="skel h-[14px] w-1/2" />
          </div>
        </CardPad>
      </Card>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <Card variant="bare" className="mb-4">
        <CardPad>
          {heading}
          <p className="text-sm text-muted-foreground">
            {t('work:budgetImpact.unavailable', "Budget unavailable — budget impact can't be shown right now.")}
          </p>
        </CardPad>
      </Card>
    );
  }

  const budgetAmount = budget.data ?? 0;

  // ── No active budget ───────────────────────────────────────────────────────
  if (budgetAmount === 0) {
    return (
      <Card variant="bare" className="mb-4">
        <CardPad>
          {heading}
          <p className="text-sm text-muted-foreground">
            {t('work:budgetImpact.noBudget', "No active budget set for this project — budget impact can't be shown.")}
          </p>
        </CardPad>
      </Card>
    );
  }

  // ── Figures (three layers, ADR-0034) ─────────────────────────────────────────
  // Interdependent budget math lives in the pure computeBudgetSignal helper so it is
  // independently unit-testable; this block is presentation-only.
  const committedSpend = committed.data ?? 0;
  const otherCurrencyCommitted = (committed.otherCurrencies ?? [])
    .map((position) => `${position.currency} ${formatNumberWhole(position.amount)}`).join(' · ');
  const reserved = reservedQ.data ?? 0; // TOTAL reserved (incl. this case if applicable)
  const { available, afterRequest, otherReserved, overAvailable, overAvailableAmount, overBudgetReserved } =
    computeBudgetSignal({
      budget: budgetAmount,
      committed: committedSpend,
      reserved,
      totalValue,
      status,
    });
  const afterPct = budgetAmount > 0 ? (afterRequest / budgetAmount) * 100 : 0;

  const facts = [
    ...(showRequestValue ? [{ label: t('work:budgetImpact.thisRequest', 'This request'), value: totalValue }] : []),
    { label: t('work:budgetImpact.reserved', 'Reserved · approved, not yet ordered'), value: otherReserved },
    { label: t('work:budgetImpact.available', 'Available'), value: available, negative: available < 0 },
    { label: t('work:budgetImpact.budget', 'Project budget'), value: budgetAmount },
    { label: t('work:budgetImpact.committed', 'Committed'), value: committedSpend },
  ];

  return (
    <Card variant="bare" className="mb-4">
      <CardPad>
        {heading}

        {/* Budget figures — text-labelled, tabular-nums (a11y: not color-only).
            Available (Budget − Committed − Reserved) is the over-commitment-safe
            headroom; no progress bar — an uninformative single-segment 0% bar
            misreads as broken (Wave-5 I1). */}
        {otherCurrencyCommitted && (
            <p data-testid="budget-impact-other-currencies" className="mb-3 text-sm text-muted-foreground">
            {t('work:budgetImpact.otherCurrencies', 'Not counting commitments in other currencies: {{amounts}}', { amounts: otherCurrencyCommitted })}
          </p>
        )}
        <section aria-label="Budget figures" className="mb-4">
          <div data-testid="budget-impact-primary" className="mb-8 flex flex-col items-start gap-1">
            <span className="text-xs font-semibold text-muted-foreground">
              {t('work:budgetImpact.afterRequest', 'After this request · {{percent}}% headroom remaining', { percent: formatNumberExact(Math.round(afterPct * 10) / 10) })}
            </span>
            <span className={`text-xl font-bold tabular ${afterRequest < 0 ? 'text-destructive-text' : 'text-foreground'}`}>
              {formatNumberWhole(afterRequest)}
            </span>
          </div>
          <table data-testid="budget-impact-figures" className="w-auto max-w-full border-collapse">
            <tbody>
              {facts.map((fact) => (
                <tr key={fact.label} data-testid="budget-impact-row" className="border-t border-border/60">
                  <th scope="row" className="py-2 pr-2 text-left text-xs font-semibold text-muted-foreground">
                    {fact.label}
                  </th>
                  <td
                    data-testid="budget-impact-value"
                    className={`py-2 text-left text-sm tabular ${'negative' in fact && fact.negative ? 'font-semibold text-destructive-text' : 'text-foreground'}`}
                  >
                    {formatNumberWhole(fact.value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Over-available advisory — non-blocking. ErrBanner is role="status" (gentle,
            not an alert) and carries the dollar overage in text (WCAG SC 1.4.1, not
            color-only). Approval is still permitted (OD-W5-4/OD-W5-5). */}
        {overAvailable && (
          <ErrBanner
            className="mt-3 mb-0"
            title={t('work:budgetImpact.overAvailable', 'Over available budget')}
            sub={
              <>
                {t('work:budgetImpact.overAvailableBody', 'This request exceeds available budget by {{amount}}. Approval is still permitted — this is an advisory only.', { amount: formatNumberWhole(overAvailableAmount) })}
              </>
            }
          />
        )}

        {/* Already-reserved + project over budget — no thisRequest advisory (it is
            already counted in Reserved); surface the over-budget condition instead. */}
        {overBudgetReserved && (
          <ErrBanner
            className="mt-3 mb-0"
            title={t('work:budgetImpact.overBudget', 'Project over budget')}
            sub={
              <>
                {t('work:budgetImpact.overBudgetBody', 'This project is over budget by {{amount}} across committed and reserved demand. This is an advisory only.', { amount: formatNumberWhole(-available) })}
              </>
            }
          />
        )}

        {/* Explicit affordance to drill into the project budget detail.
            Styled as a quiet link (not a competing CTA) — the decision zone
            primary action owns the blue; this is a secondary navigation escape. */}
        <div className="mt-3 pt-3 border-t border-border/50">
          <Link
            to={`/projects/${scopedProjectId}`}
            className="touch-target inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-primary-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring underline-offset-4"
          >
            {t('work:budgetImpact.openProject', 'Open project')}
          </Link>
        </div>
      </CardPad>
    </Card>
  );
};
