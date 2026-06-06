import React, { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { cn } from '@/src/components/ui/cn';

export interface AppShellProps {
  rail: React.ReactNode;
  header: React.ReactNode;
  tabstrip: React.ReactNode;
  children: React.ReactNode;
  /** Mobile drawer open state (controlled by the shell consumer / ContextBar). */
  railOpen?: boolean;
  onCloseRail?: () => void;
}

/**
 * The CSS-grid app shell: rail / header / tabstrip / main. `main` is a
 * programmatically-focusable landmark (skip-link target + focus-on-route-
 * change). ≤920px: the rail collapses (--rail-w:0 via index.css media query)
 * and renders as an overlay drawer instead.
 */
export const AppShell: React.FC<AppShellProps> = ({
  rail,
  header,
  tabstrip,
  children,
  railOpen = false,
  onCloseRail,
}) => {
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);

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

  return (
    <div
      className="grid h-screen w-screen overflow-hidden"
      style={{
        gridTemplateColumns: 'var(--rail-w) 1fr',
        gridTemplateRows: 'var(--header-h) var(--tabstrip-h) 1fr',
        gridTemplateAreas: '"rail header" "rail tabstrip" "rail main"',
      }}
    >
      <a
        href="#main"
        className="sr-only z-[1000] rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground focus:not-sr-only focus:absolute focus:left-3 focus:top-3"
      >
        Skip to main content
      </a>

      {/* Desktop rail (hidden ≤920px via the media query). */}
      {rail}

      {header}
      {tabstrip}

      <main
        id="main"
        ref={mainRef}
        tabIndex={-1}
        className="main-scroll overflow-y-auto overflow-x-hidden bg-secondary/35 outline-none"
        style={{ gridArea: 'main' }}
      >
        <div className="mx-auto max-w-[1600px] px-6 pb-16 pt-5">{children}</div>
      </main>

      {/* Mobile rail drawer overlay (≤920px). */}
      {railOpen && (
        <div className="fixed inset-0 z-[60] max-[920px]:block min-[921px]:hidden">
          <div
            className="absolute inset-0 bg-[hsl(240_10%_4%/0.4)]"
            onClick={onCloseRail}
            aria-hidden
          />
          <div className={cn('absolute inset-y-0 left-0 w-[224px] bg-card shadow-xl')}>{rail}</div>
        </div>
      )}
    </div>
  );
};
