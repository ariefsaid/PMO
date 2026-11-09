import React from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar, TaxBasisLabel, Tooltip } from '@/src/components/ui';
import { cn } from '@/src/components/ui/cn';
import { usePermission } from '@/src/auth/usePermission';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { formatCompactCurrency, formatDateOnly, formatInstantDate, formatRelativeTime } from '@/src/lib/format';
import { isTaxTreatment } from '@/src/lib/taxTreatment';
import { useBudgetUsage, useInvoicedPaid, useScheduleSummary } from './useProjectOverviewFigures';

const Fact: React.FC<{ label: string; tip?: string; children: React.ReactNode; className?: string }> = ({ label, tip, children, className }) => (
  <div className={cn('min-w-0 bg-card px-3 py-2', className)}>
    <div className="text-xs text-muted-foreground">{tip ? <Tooltip content={tip}><span tabIndex={0}>{label}</span></Tooltip> : label}</div>
    {children}
  </div>
);
const Value: React.FC<{ children: React.ReactNode }> = ({ children }) => <div className="mt-0.5 truncate text-base font-semibold tabular-nums text-foreground">{children}</div>;
const Sub: React.FC<{ tone?: 'danger' | 'warn'; children: React.ReactNode }> = ({ tone, children }) => (
  <div className={cn('truncate text-xs tabular-nums', tone === 'danger' ? 'text-destructive-text' : tone === 'warn' ? 'text-warning-foreground' : 'text-muted-foreground')}>{children}</div>
);

/**
 * The record's facts strip: the six answers to "is this project OK?" in one glance. Every figure comes from a
 * read the page already makes; money cells follow the same role gate as the Money block and are left out, never
 * guessed, when the figure is not known.
 */
export const ProjectFactsStrip: React.FC<{ project: ProjectWithRefs }> = ({ project }) => {
  const { t } = useTranslation('project');
  const may = usePermission();
  const canViewMoney = may('view', 'salesInvoice');
  const schedule = useScheduleSummary(project);
  const usage = useBudgetUsage(project);
  const billing = useInvoicedPaid(project);
  const manager = project.pm?.full_name;
  const cur = project.currency;
  const { pos } = usage;
  const updated = project.last_update ? formatRelativeTime(project.last_update) : null;
  return (
    <section aria-label={t('projectDetail.facts.ariaLabel', 'Project facts')}
      className="mb-3 grid min-w-0 grid-cols-2 gap-px overflow-hidden rounded-xl border border-border/80 bg-border/60 md:grid-cols-3 xl:grid-cols-[1.2fr_repeat(5,1fr)]">
      <Fact label={t('projectDetail.facts.manager', 'Project manager')}>
        <div className="mt-1 flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
          {manager ? <><Avatar name={manager} decorative /><span className="truncate">{manager}</span></> : <span className="font-normal text-muted-foreground">{t('projectDetail.facts.noManager', 'Not assigned')}</span>}
        </div>
      </Fact>
      <Fact label={t('projectDetail.facts.schedule', 'Schedule')}>
        <Value>{project.end_date ? formatDateOnly(project.end_date) : t('projectDetail.facts.noDates', 'Dates not set')}</Value>
        {schedule.endLate !== null
          ? <Sub tone="danger">{t('projectDetail.facts.daysLate', '{{n}} days late', { n: schedule.endLate })}{schedule.milestones.length > 0 && <> · {t('projectDetail.facts.phaseCount', '{{n}} phases', { n: schedule.milestones.length })}</>}</Sub>
          : schedule.milestones.length > 0 ? <Sub>{t('projectDetail.facts.phaseCount', '{{n}} phases', { n: schedule.milestones.length })}</Sub> : null}
      </Fact>
      <Fact label={t('projectDetail.facts.progress', 'Progress')} tip={t('projectDetail.facts.progressTooltip', 'Weighted average of phase completion using each phase weight; source: project phase plan.')}>
        {schedule.progress !== null ? (
          <>
            <Value>{schedule.progress}%{schedule.planned !== null && <span className={cn('ml-1.5 text-xs font-medium', schedule.progress < schedule.planned ? 'text-destructive-text' : 'text-muted-foreground')}>{t('projectDetail.facts.vsPlan', 'vs {{plan}}% plan', { plan: schedule.planned })}</span>}</Value>
            {updated && <Sub><Tooltip content={t('projectDetail.facts.updatedTooltip', 'Last updated on {{date}}.', { date: formatInstantDate(project.last_update) })}><time tabIndex={0} dateTime={project.last_update}>{t('projectDetail.facts.updated', 'Updated {{when}}', { when: updated })}</time></Tooltip></Sub>}
          </>
        ) : <Value>{schedule.isPending ? t('projectDetail.facts.progressLoading', 'Progress loading') : <span aria-label={t('projectDetail.facts.noPhases', 'No phases yet')}>—</span>}</Value>}
      </Fact>
      {canViewMoney && (
        <Fact label={t('projectDetail.facts.contract', 'Contract')}>
          <Value><span data-testid="contract-value-amount">{project.contract_value == null ? '—' : formatCompactCurrency(project.contract_value, cur)}</span></Value>
          {isTaxTreatment(project.tax_treatment) && <Sub><TaxBasisLabel treatment={project.tax_treatment} taxRate={project.tax_rate} showDetails={false} className="inline" /></Sub>}
        </Fact>
      )}
      {canViewMoney && (
        <Fact label={t('projectDetail.facts.budgetUsed', 'Budget used')} tip={t('projectDetail.facts.budgetTooltip', 'Recorded spending against the active budget; the line below adds purchase orders already committed. Same totals as the Budget tab.')}>
          {pos.hasBudget ? (
            <>
              <Value>{pos.spent !== null
                ? <>{formatCompactCurrency(pos.spent, cur)} <span className="text-xs font-medium text-muted-foreground">{t('projectDetail.facts.ofBudget', 'of {{budget}}', { budget: formatCompactCurrency(pos.budget, cur) })}</span></>
                : t('projectDetail.facts.budgetOnly', '{{budget}} budget', { budget: formatCompactCurrency(pos.budget, cur) })}</Value>
              {(usage.committed || usage.usedPercent !== null) && <Sub tone={usage.usedPercent !== null && usage.usedPercent >= 90 ? 'warn' : undefined}>
                {usage.committed ? t('projectDetail.facts.committed', '+ {{amount}} committed', { amount: formatCompactCurrency(usage.committed, cur) }) : null}
                {usage.committed && usage.usedPercent !== null ? ' · ' : null}{usage.usedPercent !== null ? `${usage.usedPercent}%` : null}
              </Sub>}
            </>
          ) : <Value><span aria-label={t('projectDetail.facts.noBudget', 'No active budget')}>—</span></Value>}
        </Fact>
      )}
      {canViewMoney && (
        <Fact label={t('projectDetail.facts.invoicedPaid', 'Invoiced · paid')}>
          {billing.invoiced !== null ? (
            <>
              <Value>{formatCompactCurrency(billing.invoiced, cur)} · {billing.paid !== null ? formatCompactCurrency(billing.paid, cur) : '—'}</Value>
              {billing.count === 0 || billing.invoiced === 0 ? <Sub tone="warn">{t('projectDetail.facts.nothingBilled', 'Nothing billed yet')}</Sub> : null}
            </>
          ) : <Value><span aria-label={t('projectDetail.facts.billingUnknown', 'Not known yet')}>{billing.pending ? '…' : '—'}</span></Value>}
        </Fact>
      )}
    </section>
  );
};
