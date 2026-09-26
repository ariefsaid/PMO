import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import type { Role } from '@/src/auth/AuthContext';
import { UserRole } from '@/types';
import { cn } from '@/src/components/ui/cn';
import { Icon } from '@/src/components/ui/icons';
import { HELP_URL } from '@/src/lib/legalConfig';
import { useTheme } from '@/src/hooks/useTheme';

const IMPERSONATION_ROLES = Object.values(UserRole).filter((r) => r !== UserRole.Admin) as Role[];

function initials(name?: string | null): string {
  if (!name) return 'U';
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * AccountMenu — the ONE responsive avatar/identity account control in the top bar
 * (AC-ACCT-001). Owns the avatar/identity trigger, the single `role="menu"` popup,
 * outside-click/Escape close, arrow-key navigation, and focus return. It is the sole home of:
 *   - the signed-in identity;
 *   - the Profile & preferences link (`/settings/profile`, still directly routable);
 *   - the Theme section (Light / Dark `menuitemradio`, driven by `useTheme`);
 *   - the sample-org-only, view-only View-as-role section (gated by `canImpersonate`);
 *   - Legal & support (Terms, Privacy, optional Help);
 *   - Sign out.
 *
 * Authority contracts preserved: `canImpersonate` remains the sole UI eligibility input and
 * `viewAs` remains view-only; `useTheme` remains responsible for the document class + best-effort
 * storage; `signOut` is the auth context action. No new fetch, subscription, or persistence.
 */
export const AccountMenu: React.FC = () => {
  const { t } = useTranslation();
  const { currentUser, signOut } = useAuth();
  const { realRole, effectiveRole, canImpersonate, viewAs } = useEffectiveRole();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const menuItems = () =>
    Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]') ?? []);

  useEffect(() => {
    if (open) menuItems()[0]?.focus();
  }, [open]);

  const onMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const items = menuItems();
    const current = items.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (e.key === 'ArrowDown') next = (current + 1) % items.length;
    if (e.key === 'ArrowUp') next = (current - 1 + items.length) % items.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = items.length - 1;
    if (next !== null && items.length > 0) {
      e.preventDefault();
      items[next]?.focus();
    }
    if (e.key === 'Tab') {
      // The popup disappears on Tab. Move directly to the adjacent control in
      // document order so neither Tab nor Shift+Tab requires an extra keystroke.
      e.preventDefault();
      const trigger = triggerRef.current;
      const isVisible = (element: HTMLElement) => {
        for (let node: HTMLElement | null = element; node; node = node.parentElement) {
          if (node.hasAttribute('hidden') || node.hasAttribute('inert') || node.getAttribute('aria-hidden') === 'true') return false;
          const style = getComputedStyle(node);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
        }
        return true;
      };
      const focusable = Array.from(document.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((element) =>
        (element === trigger || !rootRef.current?.contains(element)) && isVisible(element),
      );
      const index = trigger ? focusable.indexOf(trigger) : -1;
      const destination = e.shiftKey ? focusable[index - 1] ?? focusable.at(-1) : focusable[index + 1] ?? focusable[0];
      setOpen(false);
      destination?.focus();
    }
  };

  // Listeners exist ONLY while the menu is open; they clean up on close/unmount so no
  // duplicate listeners or steady-state re-render work accumulate (non-goal: performance).
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        // Escape restores focus to the trigger (AC-ACCT-003/FR-ACCT-006).
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const rowBase =
    'flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13.5px] transition-colors';

  return (
    <div ref={rootRef} className="relative flex shrink-0 items-center">
      <button
        type="button"
        ref={triggerRef}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('shell.contextBar.accountMenu', 'Account menu')}
        onClick={() => setOpen((v) => !v)}
        className="touch-target inline-flex h-8 max-w-[220px] shrink-0 items-center gap-2 rounded-lg border border-input bg-background pl-1.5 pr-2.5 hover:bg-accent"
      >
        <span
          aria-hidden
          className="grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-bold text-primary-foreground"
          style={{ background: 'linear-gradient(135deg, hsl(var(--primary)), hsl(var(--violet)))' }}
        >
          {initials(currentUser?.full_name)}
        </span>
        <span className="hidden min-w-0 max-w-[160px] flex-col items-start leading-tight sm:flex">
          <span className="block max-w-full truncate text-[13px] font-semibold">{currentUser?.full_name}</span>
          <span className="text-[11px] leading-tight text-muted-foreground">{realRole ?? effectiveRole}</span>
        </span>
        <Icon name="chev" className="hidden rotate-90 text-muted-foreground sm:block [&_svg]:size-3.5" />
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={t('shell.contextBar.accountMenu', 'Account menu')}
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 top-full z-50 mt-2 overflow-y-auto rounded-lg border border-border bg-popover p-[5px] shadow-[0_10px_30px_hsl(240_10%_8%/0.16)]"
          style={{
            width: 'min(320px, calc(100vw - 24px))',
            maxHeight: 'calc(100dvh - var(--header-h) - 16px)',
          }}
        >
          {/* Signed-in identity header */}
          <div className="flex items-center gap-2.5 px-2.5 py-2">
            <span
              aria-hidden
              className="grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-bold text-primary-foreground"
              style={{ background: 'linear-gradient(135deg, hsl(var(--primary)), hsl(var(--violet)))' }}
            >
              {initials(currentUser?.full_name)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-semibold leading-tight">
                {currentUser?.full_name}
              </span>
              <span className="block text-[11px] leading-tight text-muted-foreground">
                {realRole ?? effectiveRole}
              </span>
            </span>
          </div>

          <div className="my-1 border-t border-border" />

          {/* Profile & preferences — same translated label the direct route/breadcrumb uses. */}
          <Link
            to="/settings/profile"
            role="menuitem"
            onClick={() => setOpen(false)}
            className={cn(rowBase, 'text-foreground hover:bg-accent')}
          >
            <Icon name="pencil" className="text-muted-foreground [&_svg]:size-[17px]" />
            {t('shell.nav.profileSettings', 'Profile & preferences')}
          </Link>

          <div className="my-1 border-t border-border" />

          {/* Theme — explicit choices leave the popup open so the new selection is seen/announced. */}
          <div className="px-2.5 pt-1 pb-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('shell.contextBar.themeHeading', 'Theme')}
          </div>
          <button
            role="menuitemradio"
            aria-checked={theme === 'light'}
            type="button"
            onClick={() => setTheme('light')}
            className={cn(
              rowBase,
              theme === 'light' ? 'bg-primary/10 font-medium text-nav-active-text' : 'text-foreground hover:bg-accent',
            )}
          >
            <Icon name="sun" className="text-muted-foreground [&_svg]:size-[15px]" />
            {t('shell.contextBar.themeLight', 'Light')}
          </button>
          <button
            role="menuitemradio"
            aria-checked={theme === 'dark'}
            type="button"
            onClick={() => setTheme('dark')}
            className={cn(
              rowBase,
              theme === 'dark' ? 'bg-primary/10 font-medium text-nav-active-text' : 'text-foreground hover:bg-accent',
            )}
          >
            <Icon name="moon" className="text-muted-foreground [&_svg]:size-[15px]" />
            {t('shell.contextBar.themeDark', 'Dark')}
          </button>

          {/* Sample-org-only, view-only role preview — gated by the existing canImpersonate. */}
          {canImpersonate && (
            <>
              <div className="my-1 border-t border-border" />
              <div className="px-2.5 pt-1 pb-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t('shell.contextBar.viewAsRoleHeading', 'View as role')}
              </div>
              {effectiveRole !== realRole && (
                <button
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    viewAs(null);
                    setOpen(false);
                  }}
                  className={cn(rowBase, 'text-foreground hover:bg-accent')}
                >
                  {t('shell.contextBar.returnToAdmin', 'Return to Admin')}
                </button>
              )}
              {IMPERSONATION_ROLES.map((role) => (
                <button
                  key={role}
                  role="menuitemradio"
                  aria-checked={effectiveRole === role}
                  type="button"
                  onClick={() => {
                    viewAs(role);
                    setOpen(false);
                  }}
                  className={cn(
                    rowBase,
                    effectiveRole === role
                      ? 'bg-primary/10 font-medium text-nav-active-text'
                      : 'text-foreground hover:bg-accent',
                  )}
                >
                  {role}
                </button>
              ))}
            </>
          )}

          <div className="my-1 border-t border-border" />
          <div className="px-2.5 pt-1 pb-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('shell.contextBar.legalAndSupport', 'Legal & support')}
          </div>
          <Link
            to="/terms"
            role="menuitem"
            onClick={() => setOpen(false)}
            className={cn(rowBase, 'text-foreground hover:bg-accent')}
          >
            {t('shell.contextBar.terms', 'Terms')}
          </Link>
          <Link
            to="/privacy"
            role="menuitem"
            onClick={() => setOpen(false)}
            className={cn(rowBase, 'text-foreground hover:bg-accent')}
          >
            {t('shell.contextBar.privacy', 'Privacy')}
          </Link>
          {HELP_URL && (
            <a
              href={HELP_URL}
              target="_blank"
              rel="noopener noreferrer"
              role="menuitem"
              aria-label={t('shell.contextBar.helpWhatsApp', 'Contact support via WhatsApp')}
              onClick={() => setOpen(false)}
              className={cn(rowBase, 'text-foreground hover:bg-accent')}
            >
              <Icon name="message" className="text-muted-foreground [&_svg]:size-[17px]" />
              {t('shell.contextBar.help', 'Help')}
            </a>
          )}

          <div className="my-1 border-t border-border" />
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              setOpen(false);
              void signOut();
            }}
            className={cn(rowBase, 'text-destructive-text hover:bg-accent')}
          >
            <Icon name="alert" className="[&_svg]:size-[17px]" />
            {t('shell.contextBar.signOut', 'Sign out')}
          </button>
        </div>
      )}
    </div>
  );
};
