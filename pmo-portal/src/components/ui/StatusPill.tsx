import React from 'react';
import { cn } from './cn';

export type StatusVariant =
  | 'open'
  | 'progress'
  | 'won'
  | 'lost'
  | 'warn'
  | 'overdue'
  | 'neutral'
  | 'draft'
  | 'violet';

/**
 * The Tinted-Status Rule: status = a 6px dot + a pill tinted ~10-18% of the
 * status hue with a DARKENED text variant (preserves DESIGN.md AA values — we
 * never use the base hue as text). Darkened text values are sanctioned inline
 * literals (DESIGN.md "Accessibility posture"). Dot + text means it is never
 * color-only.
 */
interface PillStyle {
  /** Tailwind tint classes for bg (+ token text where a token exists). */
  cls: string;
  /** Darkened AA text color (inline literal) — omitted when a token covers it. */
  text?: string;
  /** Dot color (token or literal). */
  dot: string;
}

const STYLES: Record<StatusVariant, PillStyle> = {
  open: { cls: 'bg-primary/10', text: 'hsl(221 75% 38%)', dot: 'hsl(var(--primary))' },
  // I1: quiet neutral in-flight pill — differentiates non-active stages from the
  // single blue `open` by tint, while the distinct stage LABEL carries identity
  // (so it is never color-only, and never invents a per-stage hue = the rainbow).
  progress: { cls: 'bg-secondary text-secondary-foreground', dot: 'hsl(var(--muted-foreground))' },
  won: { cls: 'bg-success/12', text: 'hsl(142 64% 30%)', dot: 'hsl(var(--success))' },
  lost: { cls: 'bg-destructive/10', text: 'hsl(0 72% 45%)', dot: 'hsl(var(--destructive))' },
  warn: { cls: 'bg-warning/18 text-warning-foreground', dot: 'hsl(var(--warning))' },
  overdue: { cls: 'bg-warning/18 text-warning-foreground', dot: 'hsl(var(--warning))' },
  neutral: { cls: 'bg-secondary text-muted-foreground', dot: 'hsl(var(--muted-foreground))' },
  draft: { cls: 'bg-secondary text-secondary-foreground', dot: 'hsl(var(--muted-foreground))' },
  // Categorical violet — NON-interactive categorization only (DESIGN.md: KPI/avatar/
  // timeline/type pills, never an action color). Tinted violet/12 + the darkened-AA
  // text hsl(262 60% 42%) from crud-companies.html (7.4:1 on white).
  violet: { cls: 'bg-violet/12', text: 'hsl(262 60% 42%)', dot: 'hsl(var(--violet))' },
};

export interface StatusPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant: StatusVariant;
  children: React.ReactNode;
}

export const StatusPill: React.FC<StatusPillProps> = ({
  variant,
  children,
  className,
  style,
  ...rest
}) => {
  const s = STYLES[variant];
  return (
    <span
      className={cn(
        'inline-flex h-[22px] items-center gap-1.5 rounded-full pl-2 pr-[9px] text-[12px] font-semibold whitespace-nowrap',
        s.cls,
        className
      )}
      style={s.text ? { color: s.text, ...style } : style}
      {...rest}
    >
      <span
        data-pill-dot
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full"
        style={{ background: s.dot }}
      />
      {children}
    </span>
  );
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Active context (e.g. active nav item) flips to the primary tint. */
  active?: boolean;
}

/** Count badge — quiet secondary fill; primary tint in an active context. */
export const Badge: React.FC<BadgeProps> = ({ active = false, className, children, ...rest }) => (
  <span
    className={cn(
      'inline-grid min-w-[20px] place-items-center rounded-full px-[7px] text-[11px] font-semibold tabular',
      active ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground',
      className
    )}
    {...rest}
  >
    {children}
  </span>
);
