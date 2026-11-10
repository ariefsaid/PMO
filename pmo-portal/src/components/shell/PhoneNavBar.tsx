import React from 'react';
import { Link, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { cn } from '@/src/components/ui/cn';
import { Icon, type IconName } from '@/src/components/ui/icons';
import { useIsNarrow } from '@/src/components/ui/useIsNarrow';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useOrgFeatures } from '@/src/hooks/useOrgFeatures';
import { FEATURE_ENV_DEFAULT, type OrgFeatureKey } from '@/src/lib/features';

export interface PhoneNavBarProps {
  /** Opens the existing full navigation: the rail's mobile drawer. */
  onOpenMore: () => void;
  /** Whether that drawer is currently open (drives `aria-expanded` on More). */
  moreOpen?: boolean;
}

type JobKey = 'home' | 'approvals' | 'projects' | 'finance' | 'receivables' | 'payables' | 'timesheets' | 'expenses' | 'administration';

interface Job {
  key: JobKey;
  to: string;
  icon: IconName;
  /** Org entitlement that must be on, as in the sidebar. */
  feature?: OrgFeatureKey;
  /** Finance destinations also need the real (not previewed) role to hold them, as in the sidebar. */
  realRoleOnly?: boolean;
}

const HOME: Job = { key: 'home', to: '/home', icon: 'dashboard' };
const APPROVALS: Job = { key: 'approvals', to: '/approvals', icon: 'approvals' };
const PROJECTS: Job = { key: 'projects', to: '/projects', icon: 'projects' };
const FINANCE: Job = { key: 'finance', to: '/finance', icon: 'dollar', realRoleOnly: true };
const RECEIVABLES: Job = { key: 'receivables', to: '/finance/receivables', icon: 'invoices', feature: 'revenue', realRoleOnly: true };
const PAYABLES: Job = { key: 'payables', to: '/finance/payables', icon: 'payments', feature: 'procurement', realRoleOnly: true };
const TIMESHEETS: Job = { key: 'timesheets', to: '/timesheets', icon: 'clock', feature: 'timesheets' };
const EXPENSES: Job = { key: 'expenses', to: '/expenses', icon: 'expenses' };
const ADMINISTRATION: Job = { key: 'administration', to: '/administration', icon: 'admin' };

/** Each role's three jobs for the bar (Home first, "More" opens everything else). */
const ROLE_JOBS: Record<string, Job[]> = {
  Executive: [HOME, PROJECTS, FINANCE],
  'Project Manager': [HOME, PROJECTS, APPROVALS],
  Finance: [HOME, RECEIVABLES, PAYABLES],
  Engineer: [HOME, TIMESHEETS, EXPENSES],
  Admin: [HOME, APPROVALS, ADMINISTRATION],
};

const FINANCE_ROLES = ['Executive', 'Finance', 'Admin'];

const isActive = (pathname: string, to: string) =>
  to === '/home' || to.startsWith('/finance') ? pathname === to : pathname === to || pathname.startsWith(`${to}/`);

/**
 * #2061: the phone bottom bar. The role's three jobs plus "More" (the full navigation drawer).
 *
 * Renders BELOW the `sm` breakpoint only (`useIsNarrow`, 640px) and returns `null` above it,
 * so the desktop shell keeps its rail/header layout. It ADDS no destinations: every item is a
 * route the sidebar already offers that role, gated by the same entitlements (the sidebar and
 * RLS stay the authority; this only chooses which few to keep one tap away). Search stays in
 * the top bar.
 *
 * A11y: a `nav` landmark with its own label, `aria-current="page"` on the active destination,
 * ≥44px touch targets, 14px labels, and a bottom safe-area inset below the home indicator.
 */
export const PhoneNavBar: React.FC<PhoneNavBarProps> = ({ onOpenMore, moreOpen = false }) => {
  const { t } = useTranslation('home');
  const { pathname } = useLocation();
  const isNarrow = useIsNarrow();
  const { effectiveRole, realRole } = useEffectiveRole();
  const { data: orgFeatures } = useOrgFeatures();

  if (!isNarrow) return null;

  const labels: Record<JobKey, string> = {
    home: t('nav.home', 'Home'),
    approvals: t('nav.approvals', 'Approvals'),
    projects: t('nav.projects', 'Projects'),
    finance: t('nav.finance', 'Finance'),
    receivables: t('nav.receivables', 'Receivables'),
    payables: t('nav.payables', 'Payables'),
    timesheets: t('nav.timesheets', 'Timesheets'),
    expenses: t('nav.expenses', 'Expenses'),
    administration: t('nav.administration', 'Admin'),
  };

  const jobs = (ROLE_JOBS[effectiveRole ?? ''] ?? [HOME]).filter(
    (job) =>
      (!job.feature || (orgFeatures?.[job.feature] ?? FEATURE_ENV_DEFAULT[job.feature])) &&
      (!job.realRoleOnly || FINANCE_ROLES.includes(realRole ?? '')),
  );

  const itemClass = (active: boolean) =>
    cn(
      'touch-target flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-md px-1',
      'text-control font-medium leading-tight transition-colors',
      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
      active
        ? 'bg-nav-selected-surface font-semibold text-nav-active-text'
        : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
    );

  return (
    <nav
      data-testid="phone-nav"
      aria-label={t('nav.label', 'Phone navigation')}
      // Above the canvas, below modals (60) and the command palette. The safe-area inset is
      // part of the token so the shell's bottom padding and the toast offset match exactly.
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card pb-[env(safe-area-inset-bottom)]"
      style={{ height: 'var(--phone-nav-height)' }}
    >
      <ul className="mx-auto flex h-14 max-w-[560px] items-stretch gap-0.5 px-1">
        {jobs.map((job) => {
          const active = isActive(pathname, job.to);
          return (
            <li key={job.key} className="flex min-w-0 flex-1">
              <Link to={job.to} className={itemClass(active)} aria-current={active ? 'page' : undefined}>
                <Icon name={job.icon} className="size-[18px]" />
                <span className="max-w-full truncate">{labels[job.key]}</span>
              </Link>
            </li>
          );
        })}
        <li className="flex min-w-0 flex-1">
          <button type="button" onClick={onOpenMore} aria-expanded={moreOpen} className={itemClass(false)}>
            <Icon name="menu" className="size-[18px]" />
            <span>{t('nav.more', 'More')}</span>
          </button>
        </li>
      </ul>
    </nav>
  );
};

export default PhoneNavBar;
