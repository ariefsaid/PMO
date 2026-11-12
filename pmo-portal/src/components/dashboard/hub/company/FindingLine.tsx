import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useFigureReport } from '@/src/components/ui/useFigureScope';
import type { OverdueInvoiceNeeds } from '@/src/components/dashboard/restructure/useNeedsYou';

const clauseClass = 'text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

/**
 * The line under the title: one operations clause, one finance clause, then what waits on the person. Each clause
 * links to its place; a clause whose fact is not known yet is left out (never a guessed zero).
 */
export const FindingLine: React.FC<{
  offTrack?: { count: number; atLeast: boolean; total: number | undefined };
  overdue?: OverdueInvoiceNeeds;
  approvals?: number;
}> = ({ offTrack, overdue, approvals }) => {
  const { t } = useTranslation('dashboard');
  const clauses: Array<{ key: string; to: string; text: string }> = [];
  if (offTrack) {
    const text = offTrack.count === 0
      ? t('home.findingNoneOffTrack', 'No project is off track')
      : offTrack.total !== undefined && !offTrack.atLeast
        ? t('home.findingOffTrackOf', { count: offTrack.count, total: offTrack.total, defaultValue_one: '{{count}} of {{total}} projects off track', defaultValue_other: '{{count}} of {{total}} projects off track' })
        : t('home.findingOffTrackAtLeast', { count: offTrack.count, defaultValue_one: 'At least {{count}} project off track', defaultValue_other: 'At least {{count}} projects off track' });
    clauses.push({ key: 'ops', to: '/projects', text });
  }
  if (overdue) {
    const text = overdue.count === 0
      ? t('home.findingNoneOverdue', 'No client invoice overdue')
      : overdue.oldestDays !== null
        ? t('home.findingOverdueOldest', { count: overdue.count, days: overdue.oldestDays, defaultValue_one: '{{count}} client invoice overdue, {{days}} days', defaultValue_other: '{{count}} client invoices overdue, oldest {{days}} days' })
        : t('home.findingOverdue', { count: overdue.count, defaultValue_one: '{{count}} client invoice overdue', defaultValue_other: '{{count}} client invoices overdue' });
    clauses.push({ key: 'finance', to: '/finance/receivables?overdue=true', text });
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
