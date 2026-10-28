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
 * Status is conveyed through a paired semantic surface + text token, with a small
 * dot retained as a secondary cue. The label always carries the status meaning,
 * including for people who do not distinguish the colours.
 */
interface PillStyle {
  /** Label text color as a Tailwind utility (neutral + warning variants). */
  labelCls?: string;
  /** Label text color via an AA token (hsl(var(--status-*-text))) — colored variants. */
  labelColor?: string;
  /** Paired semantic status surface. */
  surfaceCls: string;
  /** Dot color (token via hsl(var(--x))). */
  dot: string;
  /**
   * ⚑ NEW-9 — extra dot classes for a state that is genuinely IN FLIGHT. `progress` rendered
   * byte-identically to `neutral` (same muted label, same muted dot, nothing else), so the two
   * differed ONLY by their label string — on the one state that is transient and never self-updates.
   * ADR-0068's monochrome-calm forbids buying that distinction with hue, so it is bought with SHAPE:
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
  // Colored variants use the matching status surface and AA text tokens.
  open: { labelColor: 'hsl(var(--status-open-text))', surfaceCls: 'bg-status-neutral-surface', dot: 'hsl(var(--primary))' },
  won: { labelColor: 'hsl(var(--status-won-text))', surfaceCls: 'bg-status-success-surface', dot: 'hsl(var(--success))' },
  lost: { labelColor: 'hsl(var(--status-lost-text))', surfaceCls: 'bg-status-danger-surface', dot: 'hsl(var(--destructive))' },
  violet: { labelColor: 'hsl(var(--status-violet-text))', surfaceCls: 'bg-status-violet-surface', dot: 'hsl(var(--violet))' },
  // Warning variants use the AA amber label on the matching pale surface.
  warn: { labelCls: 'text-warning-foreground', surfaceCls: 'bg-status-warning-surface', dot: 'hsl(var(--warning))' },
  overdue: { labelCls: 'text-warning-foreground', surfaceCls: 'bg-status-warning-surface', dot: 'hsl(var(--warning))' },
  // Neutral variants share the AA neutral label + surface pair.
  progress: {
    labelCls: 'text-count-foreground',
    surfaceCls: 'bg-status-neutral-surface',
    dot: 'hsl(var(--muted-foreground))',
    dotCls: 'outline outline-1 outline-offset-2 outline-current',
  },
  neutral: { labelCls: 'text-count-foreground', surfaceCls: 'bg-status-neutral-surface', dot: 'hsl(var(--muted-foreground))' },
  draft: { labelCls: 'text-count-foreground', surfaceCls: 'bg-status-neutral-surface', dot: 'hsl(var(--muted-foreground))' },
  superseded: { labelCls: 'text-count-foreground', surfaceCls: 'bg-status-neutral-surface', dot: 'hsl(var(--muted-foreground))' },
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
        'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2 text-control font-normal whitespace-nowrap',
        s.surfaceCls,
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
