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
  | 'superseded'
  | 'violet';

/**
 * The Quiet-Status Rule (ADR-0037 monochrome-calm): status = a small colored
 * DOT + a colored LABEL on the surrounding surface — NEVER a loud filled slab.
 * No tinted pill background, no pill chrome (rounded/horizontal padding). The dot
 * carries the hue; the AA `-text` token carries the label color; the word carries
 * identity. Dot + label means it is never color-only.
 *
 * Label colors are the AA `--status-*-text` / `--warning-foreground` token values
 * (open=blue, won=success, lost=destructive, warn/overdue=warning, violet=violet)
 * or `--muted-foreground` for the grey variants (progress/neutral/draft/superseded).
 * Each clears ≥4.5:1 on the plain canvas/card surface in BOTH themes (verified per
 * reskin/_app.css §0 — these are the same token values, computed against white +
 * the dark canvas/card). The dot keeps the per-variant hue.
 */
interface PillStyle {
  /** Label text color as a Tailwind utility (grey + warn variants). */
  labelCls?: string;
  /** Label text color via an AA token (hsl(var(--status-*-text))) — colored variants. */
  labelColor?: string;
  /** Dot color (token via hsl(var(--x))). */
  dot: string;
  /**
   * ⚑ NEW-9 — extra dot classes for a state that is genuinely IN FLIGHT. `progress` rendered
   * byte-identically to `neutral` (same muted label, same muted dot, nothing else), so the two
   * differed ONLY by their label string — on the one state that is transient and never self-updates.
   * ADR-0037's monochrome-calm forbids buying that distinction with hue, so it is bought with SHAPE:
   * a halo ring around the dot, which reads as "radiating / still happening" while staying in the
   * same ink.
   *
   * ⚑ It is deliberately STATIC. `motion-safe:animate-pulse` was tried first and measured: on the
   * project Tasks board — where most cards are `In Progress` — the animation storm crashed the page
   * outright under the AC-MOBILE-OVERFLOW-001 sweep at 390px (`Target page, context or browser has
   * been closed`, reproducible; the same run passed with the animation removed). A status token is
   * rendered dozens of times per screen, so it must cost nothing.
   */
  dotCls?: string;
}

const STYLES: Record<StatusVariant, PillStyle> = {
  // colored variants — label color from the AA --status-*-text token (inline hsl(var()))
  open: { labelColor: 'hsl(var(--status-open-text))', dot: 'hsl(var(--primary))' },
  won: { labelColor: 'hsl(var(--status-won-text))', dot: 'hsl(var(--success))' },
  lost: { labelColor: 'hsl(var(--status-lost-text))', dot: 'hsl(var(--destructive))' },
  violet: { labelColor: 'hsl(var(--status-violet-text))', dot: 'hsl(var(--violet))' },
  // warn/overdue — AA amber label via the --warning-foreground token utility
  warn: { labelCls: 'text-warning-foreground', dot: 'hsl(var(--warning))' },
  overdue: { labelCls: 'text-warning-foreground', dot: 'hsl(var(--warning))' },
  // grey variants — quiet muted label + muted dot (label carries identity, not color)
  progress: {
    labelCls: 'text-muted-foreground',
    dot: 'hsl(var(--muted-foreground))',
    dotCls: 'outline outline-1 outline-offset-2 outline-current',
  },
  neutral: { labelCls: 'text-muted-foreground', dot: 'hsl(var(--muted-foreground))' },
  draft: { labelCls: 'text-muted-foreground', dot: 'hsl(var(--muted-foreground))' },
  superseded: { labelCls: 'text-muted-foreground', dot: 'hsl(var(--muted-foreground))' },
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
        'inline-flex shrink-0 items-center gap-1.5 text-[12px] font-semibold whitespace-nowrap',
        s.labelCls,
        className
      )}
      style={s.labelColor ? { color: s.labelColor, ...style } : style}
      {...rest}
    >
      <span
        data-pill-dot
        aria-hidden="true"
        className={cn('size-1.5 shrink-0 rounded-full', s.dotCls)}
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
      'inline-grid min-w-[20px] place-items-center rounded-full px-2 text-[11px] font-semibold tabular',
      active ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground',
      className
    )}
    {...rest}
  >
    {children}
  </span>
);
