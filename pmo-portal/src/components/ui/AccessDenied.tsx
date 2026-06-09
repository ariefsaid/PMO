import React from 'react';
import { cn } from './cn';
import { Icon } from './icons';
import { Button } from './Button';

export interface AccessDeniedProps {
  /** Region heading. Defaults to a generic no-access title. */
  title?: string;
  /** Supporting copy explaining who the surface is for. */
  sub?: string;
  /** Back action handler (e.g. navigate to the dashboard). */
  onBack: () => void;
  /** Override the back-button label (defaults to "Back to Dashboard"). */
  backLabel?: string;
  className?: string;
}

/**
 * The single shared page-level "you don't have access to this page" surface (A-8).
 *
 * A CLARITY projection of the RBAC view-gates (rbac-visibility reading-rule 3): RLS/RPC
 * is the enforcement authority — this is a clean read-only denied state for a role that
 * reaches a page (via deep-link or ⌘K) it has no nav for. It is a titled landmark region
 * with a single keyboard-reachable Back action, never a wall of dead buttons.
 *
 * Strictly DESIGN.md tokens — mirrors the `ListState` empty surface (lock glyph + secondary
 * tile + muted copy + a primary action), so the three page gates read identically.
 */
export const AccessDenied: React.FC<AccessDeniedProps> = ({
  title = "You don't have access to this page",
  sub = 'This area is limited to roles that need it. If you think this is a mistake, contact your administrator.',
  onBack,
  backLabel = 'Back to Dashboard',
  className,
}) => (
  <section
    role="region"
    aria-label={title}
    className={cn(
      'flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card px-6 py-14 text-center',
      className,
    )}
  >
    <span className="grid size-[52px] place-items-center rounded-[14px] bg-secondary text-muted-foreground">
      <Icon name="lock" className="size-6" strokeWidth={1.75} />
    </span>
    <div className="text-[15px] font-semibold">{title}</div>
    <div className="max-w-[44ch] text-[13px] text-muted-foreground">{sub}</div>
    <Button variant="primary" size="sm" onClick={onBack} className="mt-1">
      <Icon name="back" />
      {backLabel}
    </Button>
  </section>
);
