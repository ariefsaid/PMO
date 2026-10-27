import React, { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Icon, ListState, ProgressBar, TaxBasisLabel } from '@/src/components/ui';
import { cn } from '@/src/components/ui/cn';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { usePermission } from '@/src/auth/usePermission';
import { useProjectFinances } from '@/src/hooks/useProjectFinances';
import { useProjectCommittedSpend } from '@/src/hooks/useProcurements';
import { useMilestones } from '@/src/hooks/useMilestones';
import { formatDateOnly, formatNumberWhole } from '@/src/lib/format';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import { isTaxTreatment } from '@/src/lib/taxTreatment';
import MilestoneStrip from './MilestoneStrip';
import { useBudgetPosition } from './useProjectPosition';

/** Whole units, no currency symbol: the block heading names the currency once. */
const whole = (value: number) => formatNumberWhole(value);
const num = (exact: string | null | undefined): number | null => (exact == null || exact === '' ? null : Number(exact));
const pctOf = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);

/** The one style for an in-block action: a quiet text action on the heading row, 44px tap area. */
export const BlockAction: React.FC<{ onClick?: () => void; to?: string; children: React.ReactNode; expanded?: boolean }> = ({ onClick, to, children, expanded }) => {
  const cls = 'touch-target inline-flex items-center text-xs font-semibold text-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  return to
    ? <Link to={to} className={cls}>{children}</Link>
    : <button type="button" onClick={onClick} aria-expanded={expanded} className={cls}>{children}</button>;
};

/** Block chrome: heading, its unit/basis once, an optional action on the same baseline. */
const Block: React.FC<{ id: string; title: string; unit?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }> = ({ id, title, unit, action, children }) => (
  <section aria-labelledby={id} className="min-w-0">
    <div className="mb-4 flex min-h-6 flex-wrap items-baseline gap-x-2">
      <h2 id={id} className="text-sm font-semibold text-foreground">{title}</h2>
      {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
      {action && <span className="ml-auto">{action}</span>}
    </div>
    {children}
  </section>
);

const Headline: React.FC<{ tone?: 'danger'; children: React.ReactNode }> = ({ tone, children }) => (
  <p className={cn('text-lg font-semibold leading-tight tabular-nums sm:text-xl', tone === 'danger' ? 'text-destructive-text' : 'text-foreground')}>{children}</p>
);
const Sub: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="mt-1 text-xs tabular-nums text-muted-foreground">{children}</p>
);
const Strong: React.FC<{ children: React.ReactNode }> = ({ children }) => <span className="font-semibold text-foreground">{children}</span>;
const Note: React.FC<{ children: React.ReactNode }> = ({ children }) => <p className="mt-4 text-xs text-muted-foreground">{children}</p>;
const FixLink: React.FC<{ to: string; children: React.ReactNode }> = ({ to, children }) => (
  <Link to={to} className="font-semibold text-primary-text hover:underline">{children}</Link>
);

/* ── Money: how much of the contract have we billed and collected? ─────────────────────────── */
export const MoneyBlock: React.FC<{ project: ProjectWithRefs }> = ({ project }) => {
  const { t } = useTranslation();
  const q = useProjectFinances(project.id);
  const unit = (
    <>
      {project.currency}
      {isTaxTreatment(project.tax_treatment) && <> · <TaxBasisLabel treatment={project.tax_treatment} showDetails={false} className="inline text-xs text-muted-foreground" /></>}
    </>
  );
  const title = t('projectDetail.money.title', 'Contract billing');
  if (q.isPending) return <Block id="pd-money" title={title} unit={unit}><ListState variant="loading" rows={2} /></Block>;
  if (q.isError || !q.data) {
    return <Block id="pd-money" title={title}><ListState variant="error" title={t('projectDetail.money.error', "Couldn't load billing")} onRetry={() => void q.refetch()} /></Block>;
  }
  const contract = project.contract_value;
  if (contract == null) {
    return (
      <Block id="pd-money" title={title}>
        <p className="text-sm text-muted-foreground">{t('projectDetail.money.noContract', 'No contract value yet. Set it from More › Change contract value to track billing.')}</p>
      </Block>
    );
  }
  const data = q.data;
  const invoiced = num(data.contract_invoiced) ?? 0;
  const leftToInvoice = num(data.remaining_to_invoice);
  const buckets = data.invoices.filter((b) => b.currency === project.currency);
  const cash = data.cash_received;
  const received = cash?.state === 'known'
    ? cash.buckets.filter((b) => b.currency === project.currency).reduce((s, b) => s + Number(b.amount), 0)
    : null;
  const outstandingKnown = buckets.length > 0 && buckets.every((b) => b.missing_outstanding === 0 && b.outstanding !== null);
  const outstanding = outstandingKnown ? buckets.reduce((s, b) => s + Number(b.outstanding), 0) : null;
  const invoicedPct = Math.min(100, pctOf(invoiced, contract));
  const receivedPct = received === null ? 0 : Math.min(100, pctOf(received, contract));
  // Owner spec: one line contract → invoiced → received, values large, labels small; read as a flow.
  const step = (label: string, value: number) => (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums leading-tight text-foreground sm:text-xl">{whole(value)}</dd>
    </div>
  );
  const arrow = <Icon name="chev" className="mt-6 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
  return (
    <Block id="pd-money" title={title} unit={unit}>
      <dl className="flex items-start gap-3 sm:gap-5">
        {step(t('projectDetail.money.contract', 'Contract'), contract)}
        {arrow}
        {step(t('projectDetail.money.invoiced', 'Invoiced'), invoiced)}
        {received !== null && <>{arrow}{step(t('projectDetail.money.received', 'Received'), received)}</>}
      </dl>
      <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-secondary" role="img"
        aria-label={t('projectDetail.money.barLabel', '{{inv}}% of the contract invoiced, {{rec}}% received', { inv: invoicedPct, rec: receivedPct })}>
        <span className="bg-success" style={{ width: `${receivedPct}%` }} />
        <span className="bg-primary" style={{ width: `${Math.max(0, invoicedPct - receivedPct)}%` }} />
      </div>
      <Sub>
        {outstanding !== null && <>{t('projectDetail.money.outstanding', 'Outstanding')} <Strong>{whole(outstanding)}</Strong> · </>}
        {leftToInvoice !== null && <>{t('projectDetail.money.leftToInvoice', 'Left to invoice')} <Strong>{whole(leftToInvoice)}</Strong></>}
      </Sub>
      {received === null && invoiced > 0 && (
        <Note>
          {t('projectDetail.money.paymentsMissing', 'Payments aren’t matched to these invoices yet, so received is left out.')}{' '}
          <FixLink to="/incoming-payments">{t('projectDetail.money.matchPayments', 'Match payments')}</FixLink>
        </Note>
      )}
    </Block>
  );
};

/* ── Cost: are we spending within budget, and where not? ─────────────────────────────────── */
export const CostBlock: React.FC<{ project: ProjectWithRefs; onOpenBudget?: () => void }> = ({ project, onOpenBudget }) => {
  const { t } = useTranslation();
  const may = usePermission();
  const canFixSetup = may('manage', 'orgAccounting');
  const pos = useBudgetPosition(project);
  const committed = useProjectCommittedSpend(may('view', 'procurement') ? project.id : null, may('view', 'procurement'));
  const label = (c: string) => budgetCategoryLabel(c, t);
  const title = t('projectDetail.cost.title', 'Budget vs actual');
  const action = onOpenBudget && <BlockAction onClick={onOpenBudget}>{t('projectDetail.cost.openBudgetArea', 'Open budget')}</BlockAction>;

  if (pos.isPending) return <Block id="pd-cost" title={title}><ListState variant="loading" rows={4} /></Block>;
  if (pos.isError) {
    return <Block id="pd-cost" title={title}><ListState variant="error" title={t('projectDetail.cost.error', "Couldn't load the budget")} onRetry={() => void pos.refetch()} /></Block>;
  }
  if (!pos.hasBudget) {
    return (
      <Block id="pd-cost" title={title} action={action}>
        <p className="text-sm text-muted-foreground">{t('projectDetail.cost.noBudget', 'No active budget yet, so spending can’t be compared.')}</p>
      </Block>
    );
  }
  const worst = pos.overRows[0];
  const started = pos.rows.filter((r): r is typeof r & { actual: number } => r.actual !== null && r.actual > 0)
    .sort((a, b) => b.actual / (b.budget || 1) - a.actual / (a.budget || 1));
  const notStarted = pos.rows.filter((r) => r.actual === 0);
  const committedFigure = committed.commitmentSource === 'pmo' && committed.data !== undefined ? committed.data : null;

  const answer = !pos.canSeeActual ? (
    <Headline>{t('projectDetail.cost.budgetOnly', 'Budget {{budget}}', { budget: whole(pos.budget) })}</Headline>
  ) : pos.projectOver !== null ? (
    <>
      <Headline tone="danger">{t('projectDetail.cost.projectOver', '{{amount}} over budget', { amount: whole(pos.projectOver) })}</Headline>
      <Sub>{t('projectDetail.cost.projectOverSub', 'Spent {{spent}} of {{budget}}', { spent: whole(pos.spent!), budget: whole(pos.budget) })}
        {worst && <> · {t('projectDetail.cost.mostly', 'mostly {{category}}', { category: label(worst.category) })}</>}</Sub>
    </>
  ) : worst ? (
    <>
      <Headline tone="danger">{t('projectDetail.cost.categoryOver', '{{category}} is {{amount}} over budget', { category: label(worst.category), amount: whole(worst.actual! - worst.budget) })}</Headline>
      <Sub>{t('projectDetail.cost.categoryOverSub', 'Spent {{spent}} of its {{budget}} budget', { spent: whole(worst.actual!), budget: whole(worst.budget) })}</Sub>
    </>
  ) : pos.spent !== null ? (
    <>
      <Headline>{t('projectDetail.cost.within', 'Within budget')}</Headline>
      <Sub>{t('projectDetail.cost.withinSub', 'Spent {{spent}} of {{budget}}', { spent: whole(pos.spent), budget: whole(pos.budget) })}</Sub>
    </>
  ) : (
    <>
      <Headline>{t('projectDetail.cost.withinRecorded', 'Within budget so far')}</Headline>
      <Sub>{t('projectDetail.cost.budgetTotal', 'Budget {{budget}}', { budget: whole(pos.budget) })}</Sub>
    </>
  );

  return (
    <Block id="pd-cost" title={title} unit={project.currency} action={action}>
      {answer}
      {committedFigure !== null && <Sub>{t('projectDetail.cost.committed', 'Plus {{amount}} committed in purchase orders', { amount: whole(committedFigure) })}</Sub>}
      {pos.canSeeActual && started.length > 0 && (
        <ul className="@container mt-6 flex flex-col gap-3">
          {started.map((r) => {
            const over = r.actual > r.budget;
            const pct = pctOf(r.actual, r.budget);
            return (
              <li key={r.category} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 @md:grid-cols-[9rem_minmax(0,1fr)_auto]">
                <span className="truncate text-sm text-foreground">{label(r.category)}</span>
                <span className={cn('text-right text-xs tabular-nums @md:order-last', over ? 'font-semibold text-destructive-text' : 'text-muted-foreground')}>
                  {t('projectDetail.cost.rowSpent', '{{spent}} of {{budget}}', { spent: whole(r.actual), budget: whole(r.budget) })}
                </span>
                <ProgressBar value={pct} tone={over ? 'destructive' : 'primary'} widthless className="col-span-2 w-full @md:col-span-1" aria-label={`${label(r.category)} ${pct}%`} />
              </li>
            );
          })}
        </ul>
      )}
      {pos.canSeeActual && notStarted.length > 0 && (
        <Note>{t('projectDetail.cost.notStarted', 'No spending yet: {{list}}', { list: notStarted.map((r) => label(r.category)).join(', ') })}</Note>
      )}
      {pos.canSeeActual && pos.unknown > 0 && (
        <Note>
          {t('projectDetail.cost.unknownNote', '{{count}} categories have no spending linked yet, so they’re left out.', { count: pos.unknown })}{' '}
          {canFixSetup
            ? <FixLink to="/administration/accounting#budget-account-map">{t('projectDetail.cost.finishSetup', 'Finish spending setup')}</FixLink>
            : t('projectDetail.cost.askAdmin', 'An administrator can finish the setup.')}
        </Note>
      )}
    </Block>
  );
};

/* ── Delivery: how far along are we, and which phase is late? ─────────────────────────────── */
const todayIso = () => new Date().toISOString().slice(0, 10);
const daysLate = (iso: string) => Math.max(1, Math.round((Date.parse(todayIso()) - Date.parse(iso)) / 86_400_000));

export const DeliveryBlock: React.FC<{ projectId: string; isPipeline?: boolean; children?: React.ReactNode }> = ({ projectId, isPipeline = false, children }) => {
  const { t } = useTranslation();
  const may = usePermission();
  const [managing, setManaging] = useState(false);
  const q = useMilestones(projectId);
  const title = t('projectDetail.delivery.title', 'Delivery');
  const action = may('edit', 'project') && (
    <BlockAction onClick={() => setManaging((m) => !m)} expanded={managing}>
      {managing ? t('projectDetail.delivery.doneManaging', 'Done') : t('projectDetail.delivery.manage', 'Update phases')}
    </BlockAction>
  );
  if (managing) return <Block id="pd-delivery" title={title} action={action}><MilestoneStrip projectId={projectId} compactWhenEmpty={isPipeline} /></Block>;
  if (q.isPending) return <Block id="pd-delivery" title={title}><ListState variant="loading" rows={3} /></Block>;
  if (q.isError) return <Block id="pd-delivery" title={title}><ListState variant="error" title={t('projectDetail.delivery.error', "Couldn't load phases")} onRetry={() => void q.refetch()} /></Block>;
  const all = q.data ?? [];
  if (all.length === 0) {
    return (
      <Block id="pd-delivery" title={title} action={action}>
        <p className="text-sm text-muted-foreground">{isPipeline
          ? t('projectDetail.delivery.emptyPipeline', 'Phases are planned once the deal is won.')
          : t('projectDetail.delivery.empty', 'No phases yet. Add phases to track delivery progress.')}</p>
      </Block>
    );
  }
  const totalWeight = all.reduce((s, m) => s + m.weight, 0);
  const pct = totalWeight > 0 ? Math.round(all.reduce((s, m) => s + m.weight * m.effective_pct, 0) / totalWeight) : 0;
  const isLate = (m: (typeof all)[number]) => Boolean(m.target_date && m.target_date < todayIso() && m.effective_pct < 100 && (m.effective_pct > 0 || m.task_count > 0));
  const current = all.find((m) => m.effective_pct < 100);
  return (
    <Block id="pd-delivery" title={title} action={action}>
      <Headline>{t('projectDetail.delivery.pct', '{{pct}}% delivered', { pct })}</Headline>
      <div className="mt-4 flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
        {all.map((m) => (
          <span key={m.id} className="relative h-full overflow-hidden bg-secondary" style={{ flexGrow: m.weight || 1, flexBasis: 0 }}>
            <span className={cn('absolute inset-y-0 left-0', m.effective_pct >= 100 ? 'bg-success' : isLate(m) ? 'bg-warning' : 'bg-primary')} style={{ width: `${Math.min(100, m.effective_pct)}%` }} />
          </span>
        ))}
      </div>
      <ol className="mt-4 flex flex-col">
        {all.map((m) => (
          <li key={m.id} className="grid grid-cols-[minmax(0,1fr)_auto_3rem] items-baseline gap-x-4 border-t border-border/70 py-2 text-sm first:border-t-0">
            <span className={cn('min-w-0 text-foreground', m.id === current?.id && 'font-semibold')}>{m.name}</span>
            <span className={cn('text-xs tabular-nums', isLate(m) ? 'font-semibold text-warning-foreground' : 'text-muted-foreground')}>
              {m.effective_pct >= 100 ? t('projectDetail.delivery.phaseDone', 'Done')
                : isLate(m) && m.target_date ? t('projectDetail.delivery.lateBy', '{{days}} days late', { days: daysLate(m.target_date) })
                : m.target_date ? t('projectDetail.delivery.target', 'Due {{date}}', { date: formatDateOnly(m.target_date) }) : ''}
            </span>
            <span className={cn('text-right tabular-nums', isLate(m) ? 'text-foreground' : 'text-muted-foreground')}>{m.effective_pct >= 100 ? '' : `${m.effective_pct}%`}</span>
          </li>
        ))}
      </ol>
      {children && <div className="mt-8">{children}</div>}
    </Block>
  );
};
