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
 * Status is conveyed through a paired semantic surface + text token. The label always
 * carries the status meaning, including for people who do not distinguish the colours;
 * the former decorative leading dot is banned (owner taste ban 2026-10-29) — colour
 * plus label carry the state, so pills render text only.
 */
interface PillStyle {
  /** Label text color as a Tailwind utility (neutral + warning variants). */
  labelCls?: string;
  /** Label text color via an AA token (hsl(var(--status-*-text))) — colored variants. */
  labelColor?: string;
  /** Paired semantic status surface. */
  surfaceCls: string;
}

const STYLES: Record<StatusVariant, PillStyle> = {
  // Colored variants use the matching status surface and AA text tokens.
  open: { labelColor: 'hsl(var(--status-open-text))', surfaceCls: 'bg-status-neutral-surface' },
  won: { labelColor: 'hsl(var(--status-won-text))', surfaceCls: 'bg-status-success-surface' },
  lost: { labelColor: 'hsl(var(--status-lost-text))', surfaceCls: 'bg-status-danger-surface' },
  violet: { labelColor: 'hsl(var(--status-violet-text))', surfaceCls: 'bg-status-violet-surface' },
  // Warning variants use the AA amber label on the matching pale surface.
  warn: { labelCls: 'text-warning-foreground', surfaceCls: 'bg-status-warning-surface' },
  overdue: { labelCls: 'text-warning-foreground', surfaceCls: 'bg-status-warning-surface' },
  // Neutral variants share the AA neutral label + surface pair.
  progress: { labelCls: 'text-count-foreground', surfaceCls: 'bg-status-neutral-surface' },
  neutral: { labelCls: 'text-count-foreground', surfaceCls: 'bg-status-neutral-surface' },
  draft: { labelCls: 'text-count-foreground', surfaceCls: 'bg-status-neutral-surface' },
  superseded: { labelCls: 'text-count-foreground', surfaceCls: 'bg-status-neutral-surface' },
};

export interface StatusPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant: StatusVariant;
  children: React.ReactNode;
  /** Let a longer translated label wrap inside a constrained card or table cell. */
  wrap?: boolean;
}

export const StatusPill: React.FC<StatusPillProps> = ({
  variant,
  children,
  wrap = false,
  className,
  style,
  ...rest
}) => {
  const s = STYLES[variant];
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center rounded-full px-2 text-control font-normal',
        s.surfaceCls,
        wrap ? 'min-w-0 max-w-full' : 'shrink-0 whitespace-nowrap',
        s.labelCls,
        className
      )}
      style={s.labelColor ? { color: s.labelColor, ...style } : style}
      {...rest}
    >
      {wrap ? <span className="min-w-0 break-words">{children}</span> : children}
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
