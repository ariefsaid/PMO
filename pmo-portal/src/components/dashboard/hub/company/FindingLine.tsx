import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Icon, type IconName } from '@/src/components/ui/icons';
import { cn } from '@/src/components/ui/cn';
import { useFigureReport } from '@/src/components/ui/useFigureScope';
import type { OverdueInvoiceNeeds } from '@/src/components/dashboard/restructure/useNeedsYou';

// Each fact is a chip: its icon and colour say the state (clear, exception, waiting), the words say the count.
const chipClass = 'inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-card px-2.5 text-control text-foreground hover:bg-accent/40 pointer-coarse:min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
type ClauseTone = 'clear' | 'bad' | 'waiting';
const TONE_ICON: Record<ClauseTone, { icon: IconName; cls: string }> = {
  clear: { icon: 'circle-check', cls: 'text-success' },
  bad: { icon: 'alert', cls: 'text-destructive' },
  waiting: { icon: 'clock', cls: 'text-warning-icon' },
};

/**
 * The line under the title: one operations clause, one finance clause, then what waits on the person. Each clause
 * links to its place; a clause whose fact is not known yet is left out (never a guessed zero).
 */
export const FindingLine: React.FC<{
  /** `unchecked`: active projects whose budget cannot be checked, so none off track is not an all-clear. */
  offTrack?: { count: number; atLeast: boolean; total: number | undefined; unchecked?: number };
  overdue?: OverdueInvoiceNeeds;
  approvals?: number;
  /** A read behind the line failed: with nothing to say, the line says so and offers Retry (it never vanishes). */
  failed?: boolean;
  onRetry?: () => void;
}> = ({ offTrack, overdue, approvals, failed = false, onRetry }) => {
  const { t } = useTranslation('dashboard');
  const clauses: Array<{ key: string; to: string; text: string; tone: ClauseTone }> = [];
  if (offTrack) {
    const text = offTrack.count === 0
      ? (offTrack.unchecked ? t('home.findingNoneCheckedOffTrack', 'No checked project is off track') : t('home.findingNoneOffTrack', 'No project is off track'))
      : offTrack.total !== undefined && !offTrack.atLeast
        ? t('home.findingOffTrackOf', { count: offTrack.count, total: offTrack.total, defaultValue_one: '{{count}} of {{total}} active projects off track', defaultValue_other: '{{count}} of {{total}} active projects off track' })
        : t('home.findingOffTrackAtLeast', { count: offTrack.count, defaultValue_one: 'At least {{count}} project off track', defaultValue_other: 'At least {{count}} projects off track' });
    clauses.push({ key: 'ops', to: '/projects', text, tone: offTrack.count === 0 ? 'clear' : 'bad' });
  }
  if (overdue) {
    const text = overdue.count === 0
      ? t('home.findingNoneOverdue', 'No client invoice overdue')
      : overdue.oldestDays !== null
        ? t('home.findingOverdueOldest', { count: overdue.count, days: overdue.oldestDays, defaultValue_one: '{{count}} client invoice overdue, {{days}} days', defaultValue_other: '{{count}} client invoices overdue, oldest {{days}} days' })
        : t('home.findingOverdue', { count: overdue.count, defaultValue_one: '{{count}} client invoice overdue', defaultValue_other: '{{count}} client invoices overdue' });
    clauses.push({ key: 'finance', to: '/finance/receivables?overdue=true', text, tone: overdue.count === 0 ? 'clear' : 'bad' });
  }
  if (approvals) clauses.push({ key: 'approvals', to: '/approvals', text: t('home.findingApprovals', { count: approvals, defaultValue_one: '{{count}} approval waits on you', defaultValue_other: '{{count}} approvals wait on you' }), tone: 'waiting' });
  if (clauses.length === 0) {
    if (!failed) return null;
    return (
      <p data-testid="home-finding" role="status" className="flex flex-wrap items-baseline gap-x-3 text-control text-muted-foreground">
        <span>{t('home.findingUnavailable', 'Summary unavailable')}</span>
        {onRetry && <button type="button" onClick={onRetry} className="font-medium text-primary-text hover:underline pointer-coarse:min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{t('home.retry', 'Retry')}</button>}
      </p>
    );
  }
  return (
    <ul data-testid="home-finding" className="flex list-none flex-wrap items-center gap-2 p-0">
      {clauses.map((clause) => (
        <li key={clause.key}>
          <Link to={clause.to} className={chipClass}>
            <Icon name={TONE_ICON[clause.tone].icon} className={cn('size-4 shrink-0', TONE_ICON[clause.tone].cls)} />
            {clause.text}
          </Link>
        </li>
      ))}
    </ul>
  );
};

/** Projects whose budget cannot be checked: one entry in the page's Why list, with the link to fix it. */
export const UncheckedReport: React.FC<{ count: number }> = ({ count }) => {
  const { t } = useTranslation('dashboard');
  useFigureReport(count > 0 ? [{
    label: t('home.budgetCheck', 'Budget check'),
    reason: t('home.uncheckedProjectsShort', { count, defaultValue_one: 'Budget check unavailable for {{count}} project', defaultValue_other: 'Budget check unavailable for {{count}} projects' }),
    link: { to: '/projects', label: t('dashboard:hub.company.openProjects', 'Open projects') },
  }] : []);
  return null;
};

/** Explain once why the pipeline figures were withheld. */
export const PipelineCurrencyReport: React.FC<{ mixed: boolean; margin: boolean }> = ({ mixed, margin }) => {
  const { t } = useTranslation('dashboard');
  useFigureReport([
    ...(mixed ? [{ label: t('home.pipelineWeighted', 'Weighted pipeline'), reason: t('home.pipelineMixedCurrency', 'Pipeline weighted amounts are hidden for mixed currencies.') }] : []),
    ...(margin ? [{ label: t('hub.company.forecastMargin', 'Forecast margin'), reason: t('home.marginCurrencyMismatch', 'Forecast margin is hidden when a contract currency differs from the budget currency.') }] : []),
  ]);
  return null;
};
