import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Menu } from '@/src/components/ui/menu';
import { Avatar } from '@/src/components/ui/Avatar';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import type { Role } from '@/src/auth/AuthContext';
import { UserRole } from '@/types';
import { cn } from '@/src/components/ui/cn';
import { menuItemClass, menuPopupClass, menuPopupOrigin, menuSeparatorClass } from '@/src/components/ui/menuStyles';
import { Icon } from '@/src/components/ui/icons';
import { HELP_URL } from '@/src/lib/legalConfig';
import { useTheme } from '@/src/hooks/useTheme';
import { useTextSize, type TextSize } from '@/src/hooks/useTextSize';
import { useOrgFeatures } from '@/src/hooks/useOrgFeatures';
import { useOverlayPortalContainer } from '@/src/components/ui/useOverlayPortalContainer';

const SHOW_LEGAL_SUPPORT = false;

const IMPERSONATION_ROLES = Object.values(UserRole).filter((r) => r !== UserRole.Admin) as Role[];

/**
 * FIN-S9: the personal M365 connect doorway (/integrations), moved here from the rail. Shown only to an entitled
 * org (the `m365_integration` entitlement defaults OFF), so a non-entitled org sees no dead link. Mounted only while
 * the menu is open, so the entitlement read costs nothing until then.
 */
const MyIntegrationsItem: React.FC<{ className: string }> = ({ className }) => {
  const { t } = useTranslation();
  const { data: orgFeatures } = useOrgFeatures();
  if (orgFeatures?.m365_integration !== true) return null;
  return (
    <Menu.LinkItem render={<Link to="/integrations" />} className={className}>
      <Icon name="plug" className="text-muted-foreground [&_svg]:size-[17px]" />
      {t('shell.nav.integrations', 'My integrations')}
    </Menu.LinkItem>
  );
};

/**
 * AccountMenu — the ONE responsive avatar/identity account control in the top bar
 * (AC-ACCT-001), on Base UI Menu: focus, arrow/Home/End roving, Tab/Escape dismissal, focus return and
 * flip/clamp positioning come from the library. It is the sole home of:
 *   - the signed-in identity;
 *   - the Profile & preferences link (`/settings/profile`, still directly routable);
 *   - the Theme section (Light / Dark `menuitemradio`, driven by `useTheme`);
 *   - the sample-org-only, view-only View-as-role section (gated by `canImpersonate`);
 *   - Sign out.
 *
 * Authority contracts preserved: `canImpersonate` remains the sole UI eligibility input and
 * `viewAs` remains view-only; `useTheme` remains responsible for the document class + best-effort
 * storage; `signOut` is the auth context action. No new fetch, subscription, or persistence.
 */
const TEXT_SIZES: TextSize[] = ['default', 'large', 'larger'];

export const AccountMenu: React.FC = () => {
  const { t } = useTranslation();
  const { currentUser, signOut } = useAuth();
  const { realRole, effectiveRole, canImpersonate, viewAs } = useEffectiveRole();
  const { theme, setTheme } = useTheme();
  const { textSize, setTextSize } = useTextSize();
  const rootRef = useRef<HTMLDivElement>(null);
  const positionerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const portalContainer = useOverlayPortalContainer(rootRef);
  const [menuOpen, setMenuOpen] = useState(false);
  const [viewport, setViewport] = useState(() => typeof window === 'undefined'
    ? { width: 1280, height: 800 }
    : { width: window.innerWidth, height: window.innerHeight });

  useEffect(() => {
    const updateViewport = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', updateViewport);
    return () => window.removeEventListener('resize', updateViewport);
  }, []);

  const zoom = textSize === 'larger' ? 1.25 : textSize === 'large' ? 1.125 : 1;

  useLayoutEffect(() => {
    if (!menuOpen) return;

    let frame = 0;
    const correctPosition = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          const menu = menuRef.current;
          const positioner = positionerRef.current;
          if (!menu || !positioner) return;

          const bounds = menu.getBoundingClientRect();
          const padding = 12;
          const horizontalCorrection = bounds.left < padding
            ? padding - bounds.left
            : bounds.right > viewport.width - padding
              ? viewport.width - padding - bounds.right
              : 0;
          const verticalCorrection = bounds.top < padding
            ? padding - bounds.top
            : bounds.bottom > viewport.height - padding
              ? viewport.height - padding - bounds.bottom
              : 0;
          positioner.style.translate = `${horizontalCorrection / zoom}px ${verticalCorrection / zoom}px`;
        });
      });
    };

    correctPosition();
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(correctPosition);
    if (menuRef.current) resizeObserver?.observe(menuRef.current);
    if (positionerRef.current) resizeObserver?.observe(positionerRef.current);
    window.addEventListener('resize', correctPosition);
    window.addEventListener('scroll', correctPosition, true);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', correctPosition);
      window.removeEventListener('scroll', correctPosition, true);
    };
  }, [menuOpen, viewport.width, viewport.height, zoom]);

  const rowBase = cn(menuItemClass, 'transition-colors');
  const rowClass = cn(rowBase, 'text-foreground data-[highlighted]:bg-accent');
  const radioClass = cn(
    rowBase,
    'text-foreground data-[highlighted]:bg-accent data-[checked]:bg-primary/10 data-[checked]:font-medium data-[checked]:text-nav-active-text',
  );
  const groupLabelClass = 'px-2.5 pt-1 pb-0.5 text-control font-medium text-muted-foreground';
  const sep = <Menu.Separator className={menuSeparatorClass} />;
  const textSizeLabel = (size: TextSize) =>
    size === 'default' ? t('profilePreferences:textSize.default', 'Default') : size === 'large' ? t('profilePreferences:textSize.large', 'Large') : t('profilePreferences:textSize.larger', 'Larger');

  return (
    <div ref={rootRef} className="relative flex shrink-0 items-center">
      <Menu.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <Menu.Trigger
          aria-label={t('shell.contextBar.accountMenu', 'Account menu')}
          className="touch-target inline-flex h-auto min-h-11 min-w-11 max-w-[220px] shrink-0 items-center gap-2 rounded-lg border border-transparent bg-card py-1 pl-1.5 pr-2.5 hover:bg-accent"
        >
          <Avatar name={currentUser?.full_name} decorative fallback="U" />
          <span className="hidden min-w-0 max-w-[160px] flex-col items-start leading-tight sm:flex">
            <span className="block max-w-full break-words text-control font-semibold">{currentUser?.full_name}</span>
            <span className="break-words text-control leading-tight text-muted-foreground">{realRole ?? effectiveRole}</span>
          </span>
          <Icon name="chev" className="hidden rotate-90 text-muted-foreground sm:block [&_svg]:size-3.5" />
        </Menu.Trigger>
        <Menu.Portal container={portalContainer}>
          <Menu.Positioner ref={positionerRef} side="bottom" align="end" sideOffset={8} collisionPadding={12} collisionAvoidance={{ align: 'shift' }} className="z-50">
            <Menu.Popup
              ref={menuRef}
              aria-label={t('shell.contextBar.accountMenu', 'Account menu')}
              className={cn(menuPopupClass, 'w-[min(320px,calc(100vw/var(--app-zoom)_-_24px))] max-h-[calc(100dvh/var(--app-zoom)_-_var(--header-h)_-_16px)]')}
              style={{
                ...menuPopupOrigin,
                maxWidth: `${Math.max(160, viewport.width - 24) / zoom}px`,
                maxHeight: `min(var(--available-height), ${Math.max(0, viewport.height - 24) / zoom}px)`,
              }}
            >
              {/* Signed-in identity header */}
              <div className="flex items-center gap-2.5 px-2.5 py-2">
                <Avatar name={currentUser?.full_name} size="md" decorative />
                <span className="min-w-0">
                  <span className="block break-words text-control font-semibold leading-tight">{currentUser?.full_name}</span>
                  <span className="block break-words text-control leading-tight text-muted-foreground">{realRole ?? effectiveRole}</span>
                </span>
              </div>

              {sep}

              {/* Profile & preferences — same translated label the direct route/breadcrumb uses. */}
              <Menu.LinkItem render={<Link to="/settings/profile" />} className={rowClass}>
                <Icon name="pencil" className="text-muted-foreground [&_svg]:size-[17px]" />
                {t('shell.nav.profileSettings', 'Profile & preferences')}
              </Menu.LinkItem>
              <MyIntegrationsItem className={rowClass} />

              {sep}

              {/* Theme — explicit choices leave the popup open so the new selection is seen/announced. */}
              <Menu.Group>
                <Menu.GroupLabel className={groupLabelClass}>{t('shell.contextBar.themeHeading', 'Theme')}</Menu.GroupLabel>
                <Menu.RadioGroup value={theme} onValueChange={(v) => setTheme(v as typeof theme)}>
                  <Menu.RadioItem value="light" closeOnClick={false} className={radioClass}>
                    <Icon name="sun" className="text-muted-foreground [&_svg]:size-[15px]" />
                    {t('shell.contextBar.themeLight', 'Light')}
                  </Menu.RadioItem>
                  <Menu.RadioItem value="dark" closeOnClick={false} className={radioClass}>
                    <Icon name="moon" className="text-muted-foreground [&_svg]:size-[15px]" />
                    {t('shell.contextBar.themeDark', 'Dark')}
                  </Menu.RadioItem>
                </Menu.RadioGroup>
              </Menu.Group>

              {sep}
              <Menu.Group>
                <Menu.GroupLabel className={groupLabelClass}>{t('profilePreferences:textSize.label', 'Text size')}</Menu.GroupLabel>
                <Menu.RadioGroup value={textSize} onValueChange={(v) => setTextSize(v as TextSize)}>
                  {TEXT_SIZES.map((size) => (
                    <Menu.RadioItem key={size} value={size} closeOnClick={false} className={radioClass}>
                      {textSizeLabel(size)}
                    </Menu.RadioItem>
                  ))}
                </Menu.RadioGroup>
              </Menu.Group>

              {/* Sample-org-only, view-only role preview — gated by the existing canImpersonate. */}
              {canImpersonate && (
                <>
                  {sep}
                  <Menu.Group>
                    <Menu.GroupLabel className={groupLabelClass}>{t('shell.contextBar.viewAsRoleHeading', 'View as role')}</Menu.GroupLabel>
                    {effectiveRole !== realRole && (
                      <Menu.Item onClick={() => viewAs(null)} className={rowClass}>
                        {t('shell.contextBar.returnToAdmin', 'Return to Admin')}
                      </Menu.Item>
                    )}
                    <Menu.RadioGroup value={effectiveRole} onValueChange={(v) => viewAs(v as Role)}>
                      {IMPERSONATION_ROLES.map((role) => (
                        <Menu.RadioItem key={role} value={role} className={radioClass}>
                          {role}
                        </Menu.RadioItem>
                      ))}
                    </Menu.RadioGroup>
                  </Menu.Group>
                </>
              )}

              {SHOW_LEGAL_SUPPORT && (
                <>
                  {sep}
                  <Menu.Group>
                    <Menu.GroupLabel className={groupLabelClass}>{t('shell.contextBar.legalAndSupport', 'Legal & support')}</Menu.GroupLabel>
                    <Menu.LinkItem render={<Link to="/terms" />} className={rowClass}>
                      {t('shell.contextBar.terms', 'Terms')}
                    </Menu.LinkItem>
                    <Menu.LinkItem render={<Link to="/privacy" />} className={rowClass}>
                      {t('shell.contextBar.privacy', 'Privacy')}
                    </Menu.LinkItem>
                  </Menu.Group>
                </>
              )}

              {HELP_URL && (
                <Menu.LinkItem
                  render={<a href={HELP_URL} target="_blank" rel="noopener noreferrer" />}
                  aria-label={t('shell.contextBar.helpWhatsApp', 'Contact support via WhatsApp')}
                  className={rowClass}
                >
                  <Icon name="message" className="text-muted-foreground [&_svg]:size-[17px]" />
                  {t('shell.contextBar.help', 'Help')}
                </Menu.LinkItem>
              )}

              {sep}
              <Menu.Item onClick={() => void signOut()} className={cn(rowBase, 'text-destructive-text data-[highlighted]:bg-accent')}>
                <Icon name="alert" className="[&_svg]:size-[17px]" />
                {t('shell.contextBar.signOut', 'Sign out')}
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  );
};
