import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import type { Role } from '@/src/auth/AuthContext';
import { UserRole } from '@/types';
import { cn } from '@/src/components/ui/cn';
import { Icon } from '@/src/components/ui/icons';
import { Breadcrumb, type BreadcrumbPart } from './Breadcrumb';

export interface ContextBarProps {
  breadcrumb: BreadcrumbPart[];
  onOpenPalette: () => void;
  /** Opens the mobile rail drawer (≤920px). */
  onToggleRail: () => void;
  /** Notification count (drives the dot + aria-label). */
  notificationCount?: number;
}

const IMPERSONATION_ROLES = Object.values(UserRole).filter((r) => r !== UserRole.Admin) as Role[];

function initials(name?: string | null): string {
  if (!name) return 'U';
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

/** Top context bar: hamburger (mobile), breadcrumb, ⌘K, notifications,
 *  Admin view-only impersonation, user chip, sign-out. */
export const ContextBar: React.FC<ContextBarProps> = ({
  breadcrumb,
  onOpenPalette,
  onToggleRail,
  notificationCount = 0,
}) => {
  const { currentUser, signOut } = useAuth();
  const { effectiveRole, canImpersonate, viewAs } = useEffectiveRole();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  return (
    <header
      className="z-30 flex items-center gap-3.5 border-b border-border bg-background px-5"
      style={{ height: 'var(--header-h)', gridArea: 'header' }}
    >
      <button
        type="button"
        aria-label="Open navigation menu"
        onClick={onToggleRail}
        className="touch-target mobile-rail-toggle hidden size-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground max-[921px]:grid [&_svg]:size-[17px]"
      >
        <Icon name="cols" />
      </button>

      <Breadcrumb parts={breadcrumb} />

      <div className="flex-1" />

      <button
        type="button"
        aria-label="Open command palette"
        aria-keyshortcuts="Meta+K Control+K"
        onClick={onOpenPalette}
        className="touch-target cmdk-trigger flex h-8 min-w-[250px] items-center gap-2 rounded-lg border border-input bg-background pl-[11px] pr-[9px] text-[13px] text-muted-foreground transition-[border-color,box-shadow] hover:border-primary/50 hover:shadow-[0_0_0_3px_hsl(var(--primary)/0.06)] max-[921px]:min-w-0 max-[921px]:w-9 max-[921px]:justify-center max-[921px]:px-0 [&_svg]:size-[15px]"
      >
        <Icon name="search" />
        <span className="cmdk-label flex-1 text-left max-[921px]:hidden">Search or jump to…</span>
        <span className="cmdk-kbd rounded-[5px] border border-border bg-secondary px-1.5 py-px text-[11px] font-semibold max-[921px]:hidden">
          ⌘K
        </span>
      </button>

      <button
        type="button"
        aria-label={
          notificationCount > 0
            ? `Notifications, ${notificationCount} unread`
            : 'Notifications'
        }
        className="touch-target relative grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-[17px]"
      >
        <Icon name="bell" />
        {notificationCount > 0 && (
          <span
            aria-hidden
            className="absolute right-1.5 top-1.5 size-[7px] rounded-full border-[1.5px] border-background bg-destructive"
          />
        )}
      </button>

      {/* Admin-only client-side impersonation (ADR-0008): view-only, does NOT
          change RLS/server identity. Behavior preserved from Header.tsx. */}
      {canImpersonate && (
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className="inline-flex h-8 items-center gap-[7px] rounded-lg border border-input bg-background pl-[11px] pr-2.5 text-[13px] font-medium text-foreground hover:bg-accent [&_svg]:size-3.5 [&_svg]:text-muted-foreground"
          >
            <span className="text-muted-foreground max-[921px]:hidden">View as role:</span>
            <strong>{effectiveRole}</strong>
            <Icon name="chev" className="rotate-90" />
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 z-50 mt-2 w-48 rounded-lg border border-border bg-popover p-[5px] shadow-[0_10px_30px_hsl(240_10%_8%/0.16)]"
            >
              {IMPERSONATION_ROLES.map((role) => (
                <button
                  key={role}
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    viewAs(role);
                    setMenuOpen(false);
                  }}
                  className={cn(
                    'flex h-8 w-full items-center rounded-md px-2.5 text-left text-[13.5px]',
                    effectiveRole === role
                      ? 'bg-primary/10 font-medium text-primary'
                      : 'hover:bg-accent'
                  )}
                >
                  {role}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2.5 border-l border-border pl-3.5">
        <span
          aria-hidden
          className="grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-bold text-primary-foreground"
          style={{ background: 'linear-gradient(135deg, hsl(var(--primary)), hsl(var(--violet)))' }}
        >
          {initials(currentUser?.full_name)}
        </span>
        <span className="user-meta flex flex-col max-[921px]:hidden">
          <span className="text-[13px] font-semibold leading-tight">
            {currentUser?.full_name}
          </span>
          <span className="text-[11px] leading-tight text-muted-foreground">{effectiveRole}</span>
        </span>
      </div>

      {/* Sign out. `shrink-0` + `whitespace-nowrap` guarantee the label never
          wraps to two lines / clips past the right edge at phone widths; ≤920px
          the cluster compacts (tighter padding) since the user name/role hide. */}
      <button
        type="button"
        onClick={() => void signOut()}
        className="inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-lg border border-input bg-background px-3 text-[13px] font-medium text-foreground hover:bg-accent max-[921px]:px-2.5"
      >
        Sign out
      </button>
    </header>
  );
};
