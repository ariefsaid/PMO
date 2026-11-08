import React from 'react';
import { Link, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { cn } from '@/src/components/ui/cn';
import { Icon, type IconName } from '@/src/components/ui/icons';
import { useIsNarrow } from '@/src/components/ui/useIsNarrow';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';

/** Roles that hold spend/approval rank (mirrors `MASTER_DATA` twice over in `policy.ts`; the
 *  Approvals page grants the expense queue to exactly this set). */
const EXPENSE_APPROVER_ROLES = ['Admin', 'Executive', 'Finance', 'Project Manager'];

export interface PhoneNavBarProps {
  /** Opens the existing command palette (the same one ⌘K opens). */
  onOpenSearch: () => void;
  /** Opens the existing full navigation — the rail's mobile drawer. */
  onOpenMore: () => void;
  /** Whether that drawer is currently open (drives `aria-expanded` on More). */
  moreOpen?: boolean;
}

/**
 * #2061 — the phone bottom bar: Home · Approvals · Search · More.
 *
 * Renders BELOW the `sm` breakpoint only (`useIsNarrow`, 640px) and returns `null` above it,
 * so the desktop shell keeps its rail/header layout pixel-identical. It ADDS no new
 * destinations: Home is `/home` (the my-queue landing), Approvals is the existing `/approvals`,
 * Search opens the existing CommandPalette through the same opener the header uses, and More
 * opens the existing rail drawer.
 *
 * Role gating matches the sidebar: an item whose action the real JWT role cannot perform
 * (`can()`/`usePermission`, ADR-0016) is not rendered. RLS remains the enforcement authority —
 * this only hides an affordance the server would refuse.
 *
 * A11y: a `nav` landmark with its own label, `aria-current="page"` on the active destination,
 * ≥44px touch targets (`.touch-target` + `min-h-11`), and a bottom safe-area inset so the bar
 * clears the home indicator on notched phones.
 */
export const PhoneNavBar: React.FC<PhoneNavBarProps> = ({ onOpenSearch, onOpenMore, moreOpen = false }) => {
  const { t } = useTranslation('home');
  const { pathname } = useLocation();
  const isNarrow = useIsNarrow();
  const may = usePermission();
  const { realRole } = useEffectiveRole();

  // Same gate the Approvals page applies before it renders the queue: procurement,
  // timesheet and invoice transitions, plus expense approval for approval rank.
  const canUseApprovals =
    may('transition', 'procurement') ||
    may('transition', 'approval') ||
    may('transition', 'salesInvoice') ||
    EXPENSE_APPROVER_ROLES.includes(realRole ?? '');

  if (!isNarrow) return null;

  const homeActive = pathname === '/home';
  const approvalsActive = pathname === '/approvals' || pathname.startsWith('/approvals/');

  const itemClass = (active: boolean) =>
    cn(
      'touch-target flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-md px-1',
      'text-[11px] font-medium leading-tight transition-colors',
      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
      active
        ? 'bg-nav-selected-surface font-semibold text-nav-active-text'
        : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
    );

  const items: Array<{ key: string; label: string; icon: IconName; node: React.ReactNode }> = [
    {
      key: 'home',
      label: t('nav.home', 'Home'),
      icon: 'dashboard',
      node: (
        <Link to="/home" className={itemClass(homeActive)} aria-current={homeActive ? 'page' : undefined}>
          <Icon name="dashboard" className="size-[18px]" />
          <span>{t('nav.home', 'Home')}</span>
        </Link>
      ),
    },
    ...(canUseApprovals
      ? [{
          key: 'approvals',
          label: t('nav.approvals', 'Approvals'),
          icon: 'approvals' as IconName,
          node: (
            <Link
              to="/approvals"
              className={itemClass(approvalsActive)}
              aria-current={approvalsActive ? 'page' : undefined}
            >
              <Icon name="approvals" className="size-[18px]" />
              <span>{t('nav.approvals', 'Approvals')}</span>
            </Link>
          ),
        }]
      : []),
    {
      key: 'search',
      label: t('nav.search', 'Search'),
      icon: 'search',
      node: (
        <button type="button" onClick={onOpenSearch} className={itemClass(false)}>
          <Icon name="search" className="size-[18px]" />
          <span>{t('nav.search', 'Search')}</span>
        </button>
      ),
    },
    {
      key: 'more',
      label: t('nav.more', 'More'),
      icon: 'menu',
      node: (
        <button
          type="button"
          onClick={onOpenMore}
          aria-expanded={moreOpen}
          className={itemClass(false)}
        >
          <Icon name="menu" className="size-[18px]" />
          <span>{t('nav.more', 'More')}</span>
        </button>
      ),
    },
  ];

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
        {items.map((item) => (
          <li key={item.key} className="flex min-w-0 flex-1">{item.node}</li>
        ))}
      </ul>
    </nav>
  );
};

export default PhoneNavBar;
