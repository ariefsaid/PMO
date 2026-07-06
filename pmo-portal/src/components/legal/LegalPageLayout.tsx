import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/src/auth/useAuth';
import { HELP_URL } from '@/src/lib/legalConfig';

/**
 * Shared chrome for the public legal pages (FR-LEG-003/004/005/024/030/031,
 * NFR-LEG-003, AC-LEG-027..033). Renders OUTSIDE <Shell>, so it owns its own
 * <main id="main"> landmark + "Skip to main content" link — mirroring the
 * in-shell pattern at AppShell.tsx:142-145,167-168 — because the bare public
 * page cannot inherit the shell's <main> (M10).
 *
 * DESIGN.md tokens: page-title (h1 24/700/-0.02em), heading (h2 20/700/-0.01em),
 * body (14/1.6), overline (11/600/0.06em). Calm control surface: content on the
 * tinted secondary ground, hairline border, muted-foreground secondary text —
 * no shadows (Flat-By-Default). Links use text-primary-text (the AA blue token,
 * index.css:46) — NOT text-primary (the action fill, sub-AA on dark per DESIGN.md).
 */
export interface LegalPageLayoutProps {
  eyebrow?: string;
  title: string;
  /** Drives the sibling cross-link: terms→Privacy, privacy→Terms. */
  variant: 'terms' | 'privacy';
  children: React.ReactNode;
}

export const LegalPageLayout: React.FC<LegalPageLayoutProps> = ({
  eyebrow = 'Legal',
  title,
  variant,
  children,
}) => {
  // Auth-aware back link (FR-LEG-005, AC-LEG-030). session===null → unauthed
  // primary audience → /login (RequireAuth bounces / → /login); session present → /.
  // AuthProvider mounts at the App root above the router, so this resolves on both.
  const { session } = useAuth();
  const back = session
    ? { label: 'Back to app', to: '/' }
    : { label: 'Back to sign in', to: '/login' };
  const crossLink =
    variant === 'terms' ? { label: 'Privacy', to: '/privacy' } : { label: 'Terms', to: '/terms' };

  return (
    <div className="min-h-[100dvh] bg-secondary/35">
      {/* Skip link — mirrors AppShell.tsx:142-145 (AC-LEG-033). */}
      <a
        href="#main"
        className="sr-only z-[1000] rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground focus:not-sr-only focus:absolute focus:left-3 focus:top-3"
      >
        Skip to main content
      </a>

      <main
        id="main"
        tabIndex={-1}
        className="mx-auto max-w-3xl px-5 pb-16 pt-10 outline-none max-[921px]:px-4 max-[921px]:pt-6"
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {eyebrow}
        </p>

        {/* Page title — page-title token (24/700/-0.02em); the single h1 (AC-LEG-004/027). */}
        <h1 className="mt-1 text-[24px] font-bold leading-[1.2] tracking-[-0.02em] text-foreground">
          {title}
        </h1>

        {/* Top navigation row (FR-LEG-024/030/031). A <div>, not <nav>, so the bare
            page has no nav landmark — "AppShell does not render" (AC-LEG-001/002) is
            unambiguous and the icon/overflow gates see a clean structure. */}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
          <Link to={back.to} className="font-medium text-primary-text hover:underline">
            {back.label}
          </Link>
          <span aria-hidden className="text-muted-foreground">·</span>
          <Link to={crossLink.to} className="font-medium text-primary-text hover:underline">
            {crossLink.label}
          </Link>
          {HELP_URL && (
            <>
              <span aria-hidden className="text-muted-foreground">·</span>
              <a
                href={HELP_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Contact support via WhatsApp"
                className="font-medium text-primary-text hover:underline"
              >
                Help
              </a>
            </>
          )}
        </div>

        <hr className="my-6 border-border" />

        {/* Body/prose container (14/1.6 for readability). Children = the <h2> sections. */}
        <div className="space-y-7 text-[14px] leading-[1.6] text-foreground">{children}</div>
      </main>
    </div>
  );
};

/** Shared section wrapper: h2 (heading token 20/700/-0.01em) + prose body. */
export const LegalSection: React.FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <section className="space-y-2">
    <h2 className="text-[20px] font-bold leading-[1.25] tracking-[-0.01em] text-foreground">
      {title}
    </h2>
    {children}
  </section>
);
