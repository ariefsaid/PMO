import React from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/src/components/ui/icons';
import { Breadcrumb, type BreadcrumbPart } from './Breadcrumb';
import { NotificationBell } from './NotificationBell';
import { AccountMenu } from './AccountMenu';

interface ContextBarProps {
  breadcrumb: BreadcrumbPart[];
  onOpenPalette: () => void;
  /** Tablet-width entry to the same full navigation drawer used by phone More. */
  onOpenMore?: () => void;
  moreOpen?: boolean;
  /** Optional control placed just before the notification bell (the Feedback button, #1532 S9). */
  beforeBell?: React.ReactNode;
}

/** Top context bar: breadcrumb, the compact-tablet More entry, ⌘K, notifications, and the single
 *  account menu (AC-ACCT-001). All personal/identity/theme/sign-out/legal controls live
 *  in the one responsive AccountMenu; no inline desktop cluster or phone-only menus. */
export const ContextBar: React.FC<ContextBarProps> = React.memo(function ContextBar({
  breadcrumb,
  onOpenPalette,
  onOpenMore,
  moreOpen = false,
  beforeBell,
}: ContextBarProps) {
  const { t } = useTranslation();

  return (
    <header
      className="z-30 flex items-center gap-3.5 border-b border-border bg-[hsl(var(--surface-panel))] px-5"
      style={{ height: 'var(--header-h)', gridArea: 'header' }}
    >
      <Breadcrumb parts={breadcrumb} />

      <div className="flex-1" />

      {onOpenMore && (
        <button
          type="button"
          aria-label={t('home:nav.more', 'More')}
          aria-expanded={moreOpen}
          data-drawer-toggle
          onClick={onOpenMore}
          className="tablet-nav-more touch-target min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Icon name="menu" aria-hidden="true" />
        </button>
      )}

      <button
        type="button"
        aria-label={t('shell.contextBar.openCommandPalette', 'Open command palette')}
        aria-keyshortcuts="Meta+K Control+K"
        onClick={onOpenPalette}
        className="touch-target cmdk-trigger flex h-8 min-h-11 min-w-[250px] items-center gap-2 rounded-lg border border-border hover:border-input bg-card px-3 text-control text-muted-foreground transition-[border-color,box-shadow] hover:border-primary/50 hover:shadow-[0_0_0_3px_hsl(var(--primary)/0.06)] max-[921px]:min-w-11 max-[921px]:w-9 max-[921px]:justify-center max-[921px]:px-0 [&_svg]:size-[15px]"
      >
        <Icon name="search" />
        <span className="cmdk-label flex-1 text-left max-[921px]:hidden">
          {t('shell.contextBar.searchPlaceholder', 'Search or jump to…')}
        </span>
        <span className="cmdk-kbd rounded-[5px] border border-border bg-secondary px-1.5 py-px text-support font-semibold max-[921px]:hidden">
          ⌘K
        </span>
      </button>

      {/* FR-AAN-034/038: the notification bell (B-5/AC-W2-IXD-008 removed it for having
          no destination — it now has one, the notifications inbox, REC-3). Shown to every
          signed-in user (AC-WFN-001..003: workflow hand-offs notify regardless of the assistant flag). */}
      {beforeBell}
      <NotificationBell />

      {/* The one responsive account menu owns identity, profile, theme, role-preview,
          legal and sign-out at every width (AC-ACCT-001). */}
      <AccountMenu />
    </header>
  );
});
