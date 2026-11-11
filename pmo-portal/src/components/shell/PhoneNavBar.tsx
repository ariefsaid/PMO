import React from 'react';
import { Link, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { cn } from '@/src/components/ui/cn';
import { Icon, type IconName } from '@/src/components/ui/icons';
import { useIsNarrow } from '@/src/components/ui/useIsNarrow';
import { ApprovalsNavCount } from './ApprovalsNavCount';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useTimesheetsAwaitingApproval, useReopenableApprovedTimesheets } from '@/src/hooks/useTimesheetApproval';

export interface PhoneNavBarProps {
  /** Opens the existing full navigation: the rail's mobile drawer. */
  onOpenMore: () => void;
  /** Opens the existing command/search palette. */
  onOpenSearch: () => void;
  /** Whether the drawer is currently open (drives `aria-expanded` on More). */
  moreOpen?: boolean;
}

type Destination = 'home' | 'approvals' | 'myTasks';

const isActive = (pathname: string, to: string) =>
  to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`);

const PhoneNavBarContent: React.FC<PhoneNavBarProps & { role: string | null; hasEligibleDecisions: boolean }> = ({
  onOpenMore,
  onOpenSearch,
  moreOpen = false,
  role,
  hasEligibleDecisions,
}) => {
  const { t } = useTranslation('home');
  const { pathname } = useLocation();
  const isNarrow = useIsNarrow();

  if (!isNarrow) return null;

  const labels: Record<Destination | 'search' | 'more', string> = {
    home: t('nav.home', 'Home'),
    approvals: t('nav.approvals', 'Approvals'),
    myTasks: t('nav.myTasks', 'My Tasks'),
    search: t('nav.search', 'Search'),
    more: t('nav.more', 'More'),
  };
  const mayViewApprovals = ['Executive', 'Project Manager', 'Finance', 'Admin'].includes(role ?? '') || hasEligibleDecisions;
  const mayViewMyTasks = ['Project Manager', 'Finance', 'Engineer', 'Admin'].includes(role ?? '');
  const destinations: { key: Destination; to: string; icon: IconName }[] = [
    { key: 'home', to: '/', icon: 'dashboard' },
    ...(mayViewApprovals ? [{ key: 'approvals' as const, to: '/approvals', icon: 'approvals' as const }] : []),
    ...(mayViewMyTasks ? [{ key: 'myTasks' as const, to: '/my-tasks', icon: 'tasks' as const }] : []),
  ];
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
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card pb-[env(safe-area-inset-bottom)]"
      style={{ height: 'var(--phone-nav-height)' }}
    >
      <ul className="mx-auto flex h-14 max-w-[560px] items-stretch gap-0.5 px-1">
        {destinations.map((destination) => {
          const active = isActive(pathname, destination.to);
          return (
            <li key={destination.key} className="flex min-w-0 flex-1">
              <Link to={destination.to} className={itemClass(active)} aria-current={active ? 'page' : undefined}>
                <Icon name={destination.icon} className="size-[18px]" />
                <span className="inline-flex max-w-full items-center justify-center gap-1">
                  <span className="max-w-full truncate">{labels[destination.key]}</span>
                  {destination.key === 'approvals' && <ApprovalsNavCount />}
                </span>
              </Link>
            </li>
          );
        })}
        <li className="flex min-w-0 flex-1">
          <button type="button" onClick={onOpenSearch} className={itemClass(false)}>
            <Icon name="search" className="size-[18px]" />
            <span>{labels.search}</span>
          </button>
        </li>
        <li className="flex min-w-0 flex-1">
          <button type="button" onClick={onOpenMore} data-drawer-toggle aria-expanded={moreOpen} className={itemClass(false)}>
            <Icon name="menu" className="size-[18px]" />
            <span>{labels.more}</span>
          </button>
        </li>
      </ul>
    </nav>
  );
};

const EngineerPhoneNavBar: React.FC<PhoneNavBarProps> = (props) => {
  const pending = useTimesheetsAwaitingApproval();
  const reopenable = useReopenableApprovedTimesheets();
  const hasEligibleDecisions = Boolean(
    pending.data?.length || reopenable.data?.length || pending.isPending || pending.isError || reopenable.isPending || reopenable.isError,
  );
  return <PhoneNavBarContent {...props} role="Engineer" hasEligibleDecisions={hasEligibleDecisions} />;
};

/** Fixed phone slots are hide-only: each role's available destinations keep this order. */
export const PhoneNavBar: React.FC<PhoneNavBarProps> = (props) => {
  const { effectiveRole } = useEffectiveRole();
  if (effectiveRole === 'Engineer') return <EngineerPhoneNavBar {...props} />;
  return <PhoneNavBarContent {...props} role={effectiveRole} hasEligibleDecisions={false} />;
};

export default PhoneNavBar;
