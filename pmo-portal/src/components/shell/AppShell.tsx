import React, { useCallback, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { cn } from '@/src/components/ui/cn';
import { Icon } from '@/src/components/ui/icons';
import { useFocusTrap } from '@/src/hooks/useFocusTrap';

export interface AppShellProps {
  rail: React.ReactNode;
  header: React.ReactNode;
  children: React.ReactNode;
  /** Optional full-bleed strip pinned to the top of `main` (e.g. the
   *  impersonation banner). Rendered above the padded content container. */
  banner?: React.ReactNode;
  /** Mobile drawer open state (controlled by the shell consumer / ContextBar). */
  railOpen?: boolean;
  onCloseRail?: () => void;
  /**
   * Agent AssistantPanel — rendered as a sibling of <main> when the
   * agentAssistant feature flag is on (FR-AP-002, AC-AP-001/002, D-A2-6).
   * The panel owns its own positioning (fixed overlay); AppShell simply mounts
   * it outside <main> so it is never inside the main landmark.
   * When undefined (flag off), nothing is rendered and the layout is unchanged.
   */
  assistant?: React.ReactNode;
}

/**
 * The CSS-grid app shell: rail / header / main. `main` is a
 * programmatically-focusable landmark (skip-link target + focus-on-route-
 * change). ≤920px: the rail collapses (--rail-w:0 via index.css media query)
 * and renders as an overlay drawer instead.
 *
 * C3 Shell Hardening (AC-IXD-MOBILE-W4-C3):
 *  - h-[100dvh] (not h-screen) — avoids the iOS Safari URL-bar viewport jump.
 *  - Mobile rail drawer is a proper modal: role=dialog aria-modal, focus-trap,
 *    Esc-to-close, scrim-to-close, visible × button, focus-in-on-open,
 *    focus-restore-to-hamburger-on-close, background inert, body scroll-lock,
 *    safe-area-inset padding.
 *  - Content gutter max-[921px]:px-4 for narrower mobile gutters.
 *  - Breadcrumb truncation is handled in Breadcrumb.tsx.
 */
export const AppShell: React.FC<AppShellProps> = ({
  rail,
  header,
  children,
  banner,
  railOpen = false,
  onCloseRail,
  assistant,
}) => {
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  // The element focused before the drawer opened (restored on close).
  const drawerTriggerRef = useRef<HTMLElement | null>(null);

  // Move focus to main on route change (a11y: focus-on-route-change) and reset
  // scroll. Skip the very first mount so we don't yank focus on load.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    mainRef.current?.focus();
    mainRef.current?.scrollTo?.({ top: 0 });
  }, [location.pathname]);

  // C3: Focus management for the drawer.
  // On open: capture the current focus target (the hamburger), then move focus
  // into the drawer. On close: restore focus to the captured trigger.
  useEffect(() => {
    if (railOpen) {
      // Capture the element that had focus before the drawer opened (the hamburger).
      drawerTriggerRef.current = document.activeElement as HTMLElement | null;
      // Move focus into the first focusable in the drawer, or the dialog itself.
      // setTimeout(0) defers past the synchronous render so the drawer DOM is
      // committed; this works in both browsers and jsdom (unlike requestAnimationFrame
      // which jsdom does not run automatically).
      const t = setTimeout(() => {
        const root = drawerRef.current;
        if (!root) return;
        const first = root.querySelector<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        (first ?? root).focus();
      }, 0);
      return () => clearTimeout(t);
    } else if (drawerTriggerRef.current) {
      drawerTriggerRef.current.focus();
      drawerTriggerRef.current = null;
    }
  }, [railOpen]);

  // C3: Body scroll-lock while drawer is open (prevents background scroll on mobile).
  useEffect(() => {
    if (railOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [railOpen]);

  // C3: Esc key closes the drawer.
  useEffect(() => {
    if (!railOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRail?.();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [railOpen, onCloseRail]);

  // C3: Focus trap — Tab/Shift+Tab cycles within the drawer panel.
  const onTrapKeyDown = useFocusTrap(drawerRef);

  const handleClose = useCallback(() => {
    onCloseRail?.();
  }, [onCloseRail]);

  return (
    <div
      className="grid h-[100dvh] w-screen overflow-hidden"
      style={{
        // minmax(0, 1fr) (not bare 1fr): a `1fr` track defaults to a min-content
        // MINIMUM, which lets a wide nowrap child (data table / toolbar) blow the
        // main column past the viewport at narrow widths — clipping right-edge
        // content (e.g. the Companies toolbar search at 375px). The 0 minimum lets
        // the track shrink so inner `overflow-x-auto` scrollers own their width.
        gridTemplateColumns: 'var(--rail-w) minmax(0, 1fr)',
        gridTemplateRows: 'var(--header-h) 1fr',
        gridTemplateAreas: '"rail header" "rail main"',
      }}
    >
      <a
        href="#main"
        className="sr-only z-[1000] rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground focus:not-sr-only focus:absolute focus:left-3 focus:top-3"
      >
        Skip to main content
      </a>

      {/* Persistent grid-area rail. Hidden ≤920px by the SAME index.css media
          query that zeroes --rail-w (single source of truth) via .rail-persistent.
          The hide lives HERE, on the grid-area wrapper — never on the Rail
          <aside> itself, so the drawer copy below stays visible.
          C3: inert while the mobile drawer is open so keyboard/screen-reader
          users cannot escape into the persistent rail. */}
      <div
        className="rail-persistent contents"
        style={{ gridArea: 'rail' }}
        // C3: make non-focusable while the drawer is open (the drawer is the
        // only keyboard surface). React 19 maps boolean true → the bare `inert`
        // attribute; undefined removes it.
        inert={railOpen || undefined}
      >
        {rail}
      </div>

      {header}

      <main
        id="main"
        ref={mainRef}
        tabIndex={-1}
        // min-w-0: a CSS-grid item defaults to min-width:auto, which lets a wide
        // child (a nowrap data table / toolbar) blow the `1fr` track past the
        // viewport at narrow widths — clipping right-edge content (e.g. the
        // Companies toolbar search at 375px). min-w-0 lets the track constrain
        // the content so inner `overflow-x-auto` scrollers handle their own width.
        // C3: inert while the mobile drawer is open.
        className="main-scroll min-w-0 overflow-y-auto overflow-x-hidden bg-secondary/35 outline-none"
        style={{ gridArea: 'main' }}
        inert={railOpen || undefined}
      >
        {banner}
        {/* C3: max-[921px]:px-4 narrows the gutter at 375px for more card
            width (16px vs 24px). max-[921px]:pt-4 matches. */}
        <div className="mx-auto max-w-[1600px] px-6 pb-16 pt-5 max-[921px]:px-4 max-[921px]:pt-4">
          {children}
        </div>
      </main>

      {/* FR-AP-002 / AC-AP-001/002: AssistantPanel is mounted outside <main> as
          a sibling so it is never inside the main landmark. When the assistant
          prop is undefined (flag off) nothing is rendered and the layout is
          byte-identical. The panel owns its own fixed-position overlay; no
          grid track is added here (design-plan §1.1, D-A2-6). */}
      {assistant}

      {/* C3: Mobile rail drawer overlay (≤920px) — proper modal dialog.
          - role=dialog aria-modal for AT
          - focus-trap (useFocusTrap) + Esc + scrim-close
          - visible × button to close
          - safe-area-inset padding so rail clears notch/home-indicator
          - background (rail-persistent + main) marked inert (above)
          - body scroll-lock (useEffect above)
          The drawer renders on all viewport sizes so SSR/RTL tests work;
          the CSS max-[921px]:block/min-[921px]:hidden hides it on desktop.
          Focus trap and Esc operate regardless of CSS visibility — this is
          intentional so the a11y contract is always satisfied.

          NOTE: onKeyDown is on the OUTER wrapper (not the dialog panel) so
          Tab events bubble from any focusable inside the drawer to the trap
          handler BEFORE userEvent / the browser moves focus naturally. The
          same pattern is used by CommandPalette. */}
      {railOpen && (
        <div
          className="fixed inset-0 z-[60] max-[921px]:block min-[921px]:hidden"
          onKeyDown={onTrapKeyDown}
        >
          {/* Scrim — desaturated near-black, low alpha (No-Pure-Black-Shadow Rule). */}
          <div
            data-testid="drawer-scrim"
            className="absolute inset-0 bg-[hsl(var(--scrim)/0.4)]"
            onClick={handleClose}
            aria-hidden
          />

          {/* Drawer panel — a proper modal dialog. */}
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            className={cn(
              'absolute inset-y-0 left-0 w-[224px] bg-card shadow-xl',
              // C3: safe-area-inset-left/top so the drawer clears notch/home-bar.
              'safe-area-drawer',
            )}
            style={{
              // C3: safe-area insets applied inline so they work without
              // Tailwind arbitrary-value support for env().
              paddingTop: 'env(safe-area-inset-top)',
              paddingLeft: 'env(safe-area-inset-left)',
              paddingBottom: 'env(safe-area-inset-bottom)',
            }}
          >
            {/* C3: Visible close (×) button at the top of the drawer.
                .touch-target extends the hit area to ≥44px on touch without
                changing the visual 32px size. */}
            <div className="flex items-center justify-end px-2 py-2">
              <button
                type="button"
                aria-label="Close navigation menu"
                onClick={handleClose}
                className="touch-target grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-[17px]"
              >
                <Icon name="x" />
              </button>
            </div>

            {/* Rail nav content — same node as the persistent rail. */}
            <div className="flex-1 overflow-y-auto">{rail}</div>
          </div>
        </div>
      )}
    </div>
  );
};
