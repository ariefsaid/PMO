import React, { useLayoutEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useTerms } from '@/src/lib/i18n/terms';
import { cn } from '@/src/components/ui/cn';
import { Icon } from '@/src/components/ui/icons';
import { useIsNarrow } from '@/src/components/ui/useIsNarrow';
import { ApprovalsNavCount } from './ApprovalsNavCount';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useHasTimesheetApprovalWork } from '@/src/hooks/useTimesheetApproval';
import { useOrgFeatures } from '@/src/hooks/useOrgFeatures';
import { FEATURE_ENV_DEFAULT, type OrgFeatureKey } from '@/src/lib/features';
import { UserRole } from '@/types';
import { visibleNavItems, type NavItem } from './Rail';
import { PHONE_DESTINATION_SLOTS, ROLE_PHONE_DESTINATIONS } from './navigationOrder';

export interface PhoneNavBarProps {
  /** Opens the existing full navigation: the rail's mobile drawer. */
  onOpenMore: () => void;
  /** Opens the existing command/search palette. */
  onOpenSearch: () => void;
  /** Whether the drawer is currently open (drives `aria-expanded` on More). */
  moreOpen?: boolean;
}

const ROLES = new Set<string>(Object.values(UserRole));
const asRole = (role: string | null): UserRole | null => (role && ROLES.has(role) ? (role as UserRole) : null);

// On the phone the Finance slot stands for the whole money area, so it stays current on its pages.
const isActive = (pathname: string, to: string) =>
  to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`);

/**
 * The shell's one bottom inset. The bar publishes its real rendered height (border, label row and the
 * device safe-area padding) as `--phone-nav-height`; the shell pads the page by it and every stacked
 * bar and toast sits on it. The stylesheet's nominal value only covers the first paint.
 */
function usePublishNavHeight(ref: React.RefObject<HTMLElement | null>, active: boolean): void {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const bar = ref.current;
    if (!active || !bar) return;
    const publish = () => {
      const height = bar.getBoundingClientRect().height;
      if (height > 0) root.style.setProperty('--phone-nav-height', `${height}px`);
    };
    publish();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish);
    // border-box: the safe-area is padding, which the default content-box never reports.
    observer?.observe(bar, { box: 'border-box' });
    if (!observer) window.addEventListener('resize', publish);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', publish);
      root.style.removeProperty('--phone-nav-height');
    };
  }, [ref, active]);
}

const PhoneNavBarContent: React.FC<PhoneNavBarProps & { hasEligibleDecisions: boolean }> = ({
  onOpenMore,
  onOpenSearch,
  moreOpen = false,
  hasEligibleDecisions,
}) => {
  const { t } = useTranslation('home');
  const { t: tc } = useTranslation();
  const terms = useTerms();
  const { pathname } = useLocation();
  const isNarrow = useIsNarrow();
  const navRef = useRef<HTMLElement>(null);
  usePublishNavHeight(navRef, isNarrow);
  const { effectiveRole, realRole } = useEffectiveRole();
  const { data: orgFeatures } = useOrgFeatures();

  if (!isNarrow) return null;
  const role = asRole(effectiveRole);

  // Same gates as the rail: the bar can only ever offer a place the rail also offers.
  const reachable = role
    ? visibleNavItems({
      role,
      realRole: asRole(realRole),
      featureEnabled: (key: OrgFeatureKey) => orgFeatures?.[key] ?? FEATURE_ENV_DEFAULT[key],
      canViewStatements: false,
      userViewsEnabled: false,
      hasEligibleTimesheets: hasEligibleDecisions,
    })
    : [];
  const byPath = new Map<string, NavItem>(reachable.map((item) => [item.to, item]));
  const picked = (ROLE_PHONE_DESTINATIONS[effectiveRole ?? ''] ?? [])
    // The inbox is in every full account's menu, but an Engineer's thumb-reach slot is spent on it only while a decision waits.
    .filter((path) => path !== '/approvals' || effectiveRole !== 'Engineer' || hasEligibleDecisions)
    .map((path) => byPath.get(path))
    .filter((item): item is NavItem => Boolean(item))
    .slice(0, PHONE_DESTINATION_SLOTS);
  const destinations: NavItem[] = [...(byPath.has('/') ? [byPath.get('/')!] : []), ...picked];

  // The same words as the rail and the breadcrumb, so a place has one name everywhere.
  const labels: Record<string, string> = {
    '/': terms.dashboard,
    '/approvals': tc('shell.nav.approvals', 'Approvals'),
    '/my-tasks': tc('shell.nav.myTasks', 'My Tasks'),
    '/projects': t('nav.short.projects', 'Projects'),
    '/timesheets': t('nav.short.timesheets', 'Timesheets'),
    '/finance': t('nav.short.finance', 'Finance'),
  };
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
      ref={navRef}
      data-testid="phone-nav"
      aria-label={t('nav.label', 'Phone navigation')}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex h-14 max-w-[560px] items-stretch gap-0.5 px-1">
        {destinations.map((destination) => {
          const active = isActive(pathname, destination.to);
          return (
            <li key={destination.to} className="flex min-w-0 flex-auto">
              <Link to={destination.to} className={itemClass(active)} aria-current={active ? 'page' : undefined}>
                <span className="relative inline-flex" data-testid="phone-nav-icon">
                  <Icon name={destination.icon} className="size-[18px]" />
                  {destination.to === '/approvals' && <ApprovalsNavCount badge />}
                </span>
                <span className="max-w-full">{labels[destination.to] ?? destination.text}</span>
              </Link>
            </li>
          );
        })}
        <li className="flex min-w-0 flex-auto">
          <button type="button" onClick={onOpenSearch} className={itemClass(false)}>
            <Icon name="search" className="size-[18px]" />
            <span>{t('nav.search', 'Search')}</span>
          </button>
        </li>
        <li className="flex min-w-0 flex-auto">
          <button type="button" onClick={onOpenMore} data-drawer-toggle aria-expanded={moreOpen} className={itemClass(false)}>
            <Icon name="menu" className="size-[18px]" />
            <span>{t('nav.more', 'More')}</span>
          </button>
        </li>
      </ul>
    </nav>
  );
};

const EngineerPhoneNavBar: React.FC<PhoneNavBarProps> = (props) => {
  const work = useHasTimesheetApprovalWork();
  const hasEligibleDecisions = Boolean(work.data || work.isPending || work.isError);
  return <PhoneNavBarContent {...props} hasEligibleDecisions={hasEligibleDecisions} />;
};

/** Home, then the role's own most-used places (fixed per role), then Search and More. */
export const PhoneNavBar: React.FC<PhoneNavBarProps> = (props) => {
  const { effectiveRole } = useEffectiveRole();
  if (effectiveRole === 'Engineer') return <EngineerPhoneNavBar {...props} />;
  return <PhoneNavBarContent {...props} hasEligibleDecisions={false} />;
};

export default PhoneNavBar;
