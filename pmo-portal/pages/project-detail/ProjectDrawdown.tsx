import React from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardHead, CardPad, ListState, ProgressBar, StatusPill } from '@/src/components/ui';
import { formatCurrency } from '@/src/lib/format';
import { useProjectDrawdown } from '@/src/hooks/useWorkOrders';

/**
 * The drawdown card (#566 / OD-CR-13) — the number the PM manages by, day one.
 *
 * A project IS the client's commitment and `contract_value` is its CEILING; the sum of issued work
 * orders is the DRAWDOWN against it. `get_project_drawdown` does the arithmetic server-side and
 * normalises BOTH sides to net of tax, returning the basis it used rather than leaving the caller
 * to infer it (`0197 §3`) — so this card renders the basis it was handed and never assumes one.
 *
 * ⚑ OVER-COMMITMENT IS THE POINT, and it is rendered in two distinct shapes because they are two
 * different situations:
 *   • ALREADY OVER — issued work orders alone exceed the ceiling. Someone acknowledged that at
 *     issue time and it is stamped on the row; the card states the overage as a fact.
 *   • WOULD GO OVER — issued fits, but issuing every draft would not. Nothing has been
 *     acknowledged yet, and this is the warning that exists so the PM sees it BEFORE the RPC
 *     refuses them at the issue step.
 * Silence in either case would defeat the control this whole feature exists to provide.
 *
 * ⚑ A NULL drawdown is an ERROR state, never a zero one. The RPC yields zero rows for a project
 * the caller cannot see, and rendering that as "0 of 0" would put a plausible number where an
 * error belongs (#508).
 */
export interface ProjectDrawdownProps {
  projectId: string;
  className?: string;
}

/**
 * One labelled money figure. Module-scoped rather than nested in the card so React keeps its
 * identity across renders (a component redeclared inside a render body remounts every time, which
 * would throw away focus and any transition on these nodes).
 *
 * `basisText` is passed in already resolved: OD-TAX-1 wants the label ON the figure, and a figure
 * that could be rendered without one is a bare number waiting to happen.
 */
const Figure: React.FC<{
  testId: string;
  label: string;
  value: number;
  currency: string;
  basisText: string;
  tone?: string;
}> = ({ testId, label, value, currency, basisText, tone }) => (
  <div data-testid={testId}>
    <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
      {label}
    </dt>
    <dd className={`mt-0.5 text-[15px] font-bold tabular${tone ? ` ${tone}` : ''}`}>
      {formatCurrency(value, currency)}
    </dd>
    <dd className="text-[11px] text-muted-foreground">{basisText}</dd>
  </div>
);

const ProjectDrawdown: React.FC<ProjectDrawdownProps> = ({ projectId, className }) => {
  const { t } = useTranslation();
  const { data, isPending, isError, refetch } = useProjectDrawdown(projectId);

  /**
   * OD-TAX-1: no bare number anywhere a treatment exists. Every figure on this card is stated on
   * the basis the RPC returned, so the label travels with each of them rather than sitting once in
   * a caption a reader can miss.
   */
  const basisLabel = (basis: string) =>
    basis === 'net'
      ? t('projectDetail.drawdown.basis.net', 'net of tax')
      : t('projectDetail.drawdown.basis.other', 'basis: {{basis}}', { basis });

  return (
    <Card variant="bare" className={className}>
      <CardHead>{t('projectDetail.drawdown.title', 'Contract drawdown')}</CardHead>
      {isPending ? (
        <ListState variant="loading" rows={3} testId="drawdown-loading" />
      ) : isError || !data ? (
        <ListState
          variant="error"
          title={t('projectDetail.drawdown.error.title', "Couldn't load the drawdown")}
          sub={t(
            'projectDetail.drawdown.error.sub',
            'The committed total against this contract could not be read. Retry, or reopen the project.',
          )}
          onRetry={() => refetch()}
        />
      ) : (
        (() => {
          const { committed, draft, ceiling, currency, basis } = data;
          const headroom = ceiling - committed;
          const pct = ceiling > 0 ? Math.round((committed / ceiling) * 100) : 0;
          const alreadyOver = committed > ceiling;
          const wouldGoOver = !alreadyOver && committed + draft > ceiling;
          const overBy = alreadyOver ? committed - ceiling : committed + draft - ceiling;

          return (
            <CardPad className="flex flex-col gap-3">
              <div
                role="group"
                aria-label={t('projectDetail.drawdown.groupLabel', 'Contract drawdown')}
                className="flex flex-col gap-3"
              >
                {ceiling > 0 ? (
                  <ProgressBar
                    value={pct}
                    showValue
                    tone={alreadyOver ? 'warning' : undefined}
                    aria-label={`${t('projectDetail.drawdown.barLabel', 'Contract drawn down')}: ${pct}%`}
                  />
                ) : (
                  <p data-testid="drawdown-no-ceiling" className="text-[12px] text-muted-foreground">
                    {t(
                      'projectDetail.drawdown.noCeiling',
                      'This project has no contract value yet, so there is no ceiling to draw against. Set the contract value to measure work orders against it.',
                    )}
                  </p>
                )}

                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                  <Figure
                    testId="drawdown-ceiling"
                    label={t('projectDetail.drawdown.ceiling', 'Contract ceiling')}
                    value={ceiling}
                    currency={currency}
                    basisText={basisLabel(basis)}
                  />
                  <Figure
                    testId="drawdown-committed"
                    label={t('projectDetail.drawdown.committed', 'Issued drawdown')}
                    value={committed}
                    currency={currency}
                    basisText={basisLabel(basis)}
                  />
                  <Figure
                    testId="drawdown-draft"
                    label={t('projectDetail.drawdown.draft', 'Draft pipeline')}
                    value={draft}
                    currency={currency}
                    basisText={basisLabel(basis)}
                  />
                  <Figure
                    testId="drawdown-headroom"
                    label={t('projectDetail.drawdown.headroom', 'Remaining headroom')}
                    value={headroom}
                    currency={currency}
                    basisText={basisLabel(basis)}
                    tone={headroom < 0 ? 'text-destructive' : undefined}
                  />
                </dl>
              </div>

              {/* ⚑ The overage is its OWN node rather than a value spliced into a sentence. Not
                  style: a figure a reader must reconstruct from a paragraph is a figure they can
                  misread, and the amount stays legible whatever the sentence around it says in
                  whichever language. The sentence is complete on its own and carries no fragment. */}
              {alreadyOver && (
                <div
                  data-testid="drawdown-over-committed"
                  className="flex flex-col gap-1"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill variant="overdue">
                      {t('projectDetail.drawdown.overCommitted', 'Over-committed')}
                    </StatusPill>
                    <span
                      data-testid="drawdown-over-amount"
                      className="text-[13px] font-bold tabular text-warning-foreground"
                    >
                      {formatCurrency(overBy, currency)}
                    </span>
                    <span className="text-[11px] text-muted-foreground">{basisLabel(basis)}</span>
                  </div>
                  <p className="text-[12px] text-muted-foreground">
                    {t(
                      'projectDetail.drawdown.overCommittedNote',
                      'Issued work orders exceed this project’s contract ceiling by the amount above. Each one was acknowledged by name when it was issued.',
                    )}
                  </p>
                </div>
              )}

              {wouldGoOver && (
                <div data-testid="drawdown-would-over-commit" className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill variant="warn">
                      {t('projectDetail.drawdown.wouldOverCommit', 'Drafts exceed the ceiling')}
                    </StatusPill>
                    <span
                      data-testid="drawdown-would-over-amount"
                      className="text-[13px] font-bold tabular text-warning-foreground"
                    >
                      {formatCurrency(overBy, currency)}
                    </span>
                    <span className="text-[11px] text-muted-foreground">{basisLabel(basis)}</span>
                  </div>
                  <p className="text-[12px] text-muted-foreground">
                    {t(
                      'projectDetail.drawdown.wouldOverCommitNote',
                      'Issuing every draft would take this project past its contract ceiling by the amount above. Issuing one of them will ask you to acknowledge that in writing.',
                    )}
                  </p>
                </div>
              )}
            </CardPad>
          );
        })()
      )}
    </Card>
  );
};

export default ProjectDrawdown;
