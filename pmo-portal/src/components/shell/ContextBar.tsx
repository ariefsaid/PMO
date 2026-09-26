import React from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/src/components/ui/icons';
import { isFeatureEnabled } from '@/src/lib/features';
import { Breadcrumb, type BreadcrumbPart } from './Breadcrumb';
import { NotificationBell } from './NotificationBell';
import { AccountMenu } from './AccountMenu';

export interface ContextBarProps {
  breadcrumb: BreadcrumbPart[];
  onOpenPalette: () => void;
  /** Opens the mobile rail drawer (≤920px). */
  onToggleRail: () => void;
}

/** Top context bar: hamburger (mobile), breadcrumb, ⌘K, notifications, and the single
 *  account menu (AC-ACCT-001). All personal/identity/theme/sign-out/legal controls live
 *  in the one responsive AccountMenu; no inline desktop cluster or phone-only menus. */
export const ContextBar: React.FC<ContextBarProps> = ({
  breadcrumb,
  onOpenPalette,
  onToggleRail,
}) => {
  const { t } = useTranslation();

  return (
    <header
      className="z-30 flex items-center gap-3.5 border-b border-border bg-background px-5"
      style={{ height: 'var(--header-h)', gridArea: 'header' }}
    >
      <button
        type="button"
        aria-label={t('shell.contextBar.openNavigation', 'Open navigation menu')}
        onClick={onToggleRail}
        className="touch-target mobile-rail-toggle hidden size-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground max-[921px]:grid [&_svg]:size-[17px]"
      >
        <Icon name="cols" />
      </button>

      <Breadcrumb parts={breadcrumb} />

      <div className="flex-1" />

      <button
        type="button"
        aria-label={t('shell.contextBar.openCommandPalette', 'Open command palette')}
        aria-keyshortcuts="Meta+K Control+K"
        onClick={onOpenPalette}
        className="touch-target cmdk-trigger flex h-8 min-w-[250px] items-center gap-2 rounded-lg border border-input bg-background pl-[11px] pr-[9px] text-[13px] text-muted-foreground transition-[border-color,box-shadow] hover:border-primary/50 hover:shadow-[0_0_0_3px_hsl(var(--primary)/0.06)] max-[921px]:min-w-0 max-[921px]:w-9 max-[921px]:justify-center max-[921px]:px-0 [&_svg]:size-[15px]"
      >
        <Icon name="search" />
        <span className="cmdk-label flex-1 text-left max-[921px]:hidden">
          {t('shell.contextBar.searchPlaceholder', 'Search or jump to…')}
        </span>
        <span className="cmdk-kbd rounded-[5px] border border-border bg-secondary px-1.5 py-px text-[11px] font-semibold max-[921px]:hidden">
          ⌘K
        </span>
      </button>

      {/* FR-AAN-034/038: the notification bell (B-5/AC-W2-IXD-008 removed it for having
          no destination — it now has one, the notifications inbox, REC-3). Gated behind
          `agentAssistant` alongside the rest of the automations + notifications layer. */}
      {isFeatureEnabled('agentAssistant') && <NotificationBell />}

      {/* The one responsive account menu owns identity, profile, theme, role-preview,
          legal and sign-out at every width (AC-ACCT-001). */}
      <AccountMenu />
    </header>
  );
};