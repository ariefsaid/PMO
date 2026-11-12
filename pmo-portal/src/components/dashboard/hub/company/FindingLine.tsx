import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useFigureReport, type FigureHelpEntry } from '@/src/components/ui/useFigureScope';
import type { OverdueInvoiceNeeds } from '@/src/components/dashboard/restructure/useNeedsYou';
import { tileMoneyLines } from '@/src/components/dashboard/restructure/currencyOrder';
import { formatTileMoney } from '@/src/lib/format';

const clauseClass = 'text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

/**
 * The line under the title: one operations clause, one finance clause, then what waits on the person. Each clause
 * links to its place; a clause whose fact is not known yet is left out (never a guessed zero).
 */
export const FindingLine: React.FC<{
  /** `unchecked`: active projects whose budget cannot be checked, so none off track is not an all-clear. */
  offTrack?: { count: number; atLeast: boolean; total: number | undefined; unchecked?: number; allClear?: boolean };
  overdue?: OverdueInvoiceNeeds;
  approvals?: number;
  /** Organisation currency: the overdue amount names it first. */
  currency?: string;
  /** Where the operations clause leads (default every project; the PM home: my projects). */
  opsHref?: string;
}> = ({ offTrack, overdue, approvals, currency = 'USD', opsHref = '/projects' }) => {
  const { t } = useTranslation('dashboard');
  const clauses: Array<{ key: string; to: string; text: React.ReactNode }> = [];
  if (offTrack) {
    const text = offTrack.count === 0
      // The company-wide all-clear: every active project checked and none off track.
      ? offTrack.allClear && offTrack.total ? t('home.findingAllOnTrack', 'All {{count}} active projects on track', { count: offTrack.total })
        : (offTrack.unchecked ? t('home.findingNoneCheckedOffTrack', 'No checked project is off track') : t('home.findingNoneOffTrack', 'No project is off track'))
      : offTrack.total !== undefined && !offTrack.atLeast
        ? t('home.findingOffTrackOf', { count: offTrack.count, total: offTrack.total, defaultValue_one: '{{count}} of {{total}} active projects off track', defaultValue_other: '{{count}} of {{total}} active projects off track' })
        : t('home.findingOffTrackAtLeast', { count: offTrack.count, defaultValue_one: 'At least {{count}} project off track', defaultValue_other: 'At least {{count}} projects off track' });
    clauses.push({ key: 'ops', to: opsHref, text });
  }
  if (overdue) {
    const text = overdue.count === 0
      ? t('home.findingNoneOverdue', 'No client invoice overdue')
      : overdue.oldestDays !== null
        ? t('home.findingOverdueOldest', { count: overdue.count, days: overdue.oldestDays, defaultValue_one: '{{count}} client invoice overdue, {{days}} days', defaultValue_other: '{{count}} client invoices overdue, oldest {{days}} days' })
        : t('home.findingOverdue', { count: overdue.count, defaultValue_one: '{{count}} client invoice overdue', defaultValue_other: '{{count}} client invoices overdue' });
    // The known overdue money, only when every overdue balance is known (never a partial sum).
    // The organisation currency is the figure; another currency takes its own line.
    const amount = overdue.count > 0 && overdue.unknownBalances === 0 && overdue.knownTotals.length > 0 ? tileMoneyLines(overdue.knownTotals, currency, formatTileMoney) : [];
    clauses.push({ key: 'finance', to: '/finance/receivables?overdue=true', text: amount.length ? <>{text} · {amount[0]}{amount.slice(1).map((line) => <span key={line} className="block">{line}</span>)}</> : text });
  }
  if (approvals) clauses.push({ key: 'approvals', to: '/approvals', text: t('home.findingApprovals', { count: approvals, defaultValue_one: '{{count}} approval waits on you', defaultValue_other: '{{count}} approvals wait on you' }) });
  if (clauses.length === 0) return null;
  return (
    <p data-testid="home-finding" className="text-control">
      {clauses.map((clause, index) => (
        <React.Fragment key={clause.key}>
          {index > 0 && <span aria-hidden className="mx-2 text-muted-foreground">·</span>}
          <Link to={clause.to} className={clauseClass}>{clause.text}</Link>
        </React.Fragment>
      ))}
    </p>
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

/** Definitions and caveats for the page's one help control (the "About Dashboard" list). Renders nothing itself. */
export const PageHelp: React.FC<{ entries: FigureHelpEntry[] }> = ({ entries }) => {
  useFigureReport([], entries);
  return null;
};
