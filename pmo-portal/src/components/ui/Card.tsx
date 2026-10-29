import React from 'react';
import { cn } from './cn';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Interactive cards get a hover state-lift; static cards stay flat. */
  interactive?: boolean;
  /** Clip overflow (for seamed table assemblies, rounded media). */
  clip?: boolean;
  /** Sits directly above a toolbar+table — square the bottom corners. */
  seam?: boolean;
  /**
   * Visual treatment (monochrome-calm reskin, content-over-containers):
   *   • `framed` (default) — the panel surface with its explicit boundary.
   *   • `bare`             — no frame: the section sits directly on the canvas
   *                          inside an existing panel.
   */
  variant?: 'framed' | 'bare';
}

/**
 * The Panel Rule: a card is defined by its 1px border + surface tone,
 * never a rest shadow. The state-lift shadow appears only on interactive hover.
 *
 * `variant="bare"` drops the frame and separates sibling content groups on the canvas.
 */
export const Card: React.FC<CardProps> = ({
  interactive = false,
  clip = false,
  seam = false,
  variant = 'framed',
  className,
  children,
  ...rest
}) => (
  <div
    className={cn(
      variant === 'framed' && 'panel-card',
      variant === 'bare' && 'space-y-[var(--space-group)]',
      clip && 'overflow-hidden',
      seam && 'panel-card-seam',
      interactive &&
        'transition-colors duration-150 hover:bg-surface-hover',
      className
    )}
    {...rest}
  >
    {children}
  </div>
);

export type CardHeadingLevel = 2 | 3 | 4 | 5 | 6;
type CardHeadProps = Omit<React.HTMLAttributes<HTMLHeadingElement>, 'aria-level'> & {
  level?: CardHeadingLevel;
  /** Optional secondary line under the heading, outside its accessible name. */
  subline?: React.ReactNode;
  /**
   * Controls that live beside the title (buttons, links, menus, file inputs). They render OUTSIDE the
   * heading so its accessible name stays the title alone. `children` must be title text only.
   * `className` styles the header row (wrapper); `ref`/`id`/`tabIndex`/aria props go to the heading.
   */
  actions?: React.ReactNode;
};

export const CardHead = React.forwardRef<HTMLHeadingElement, CardHeadProps>(({
  level = 2,
  subline,
  className,
  children,
  actions,
  ...rest
}, ref) => {
  const Heading = `h${level}` as const;
  return (
    <div
      className={cn('flex items-start gap-2 border-b border-border px-[var(--panel-inset)] py-4', className)}
    >
      <div className="min-w-0 flex-1">
        <Heading
          ref={ref}
          className="flex min-w-0 items-center gap-2 text-group font-semibold"
          {...rest}
        >
          {children}
        </Heading>
        {subline != null && <p className="mt-1 text-support font-normal text-muted-foreground">{subline}</p>}
      </div>
      {actions != null && actions !== false && (
        <div className="ml-auto flex shrink-0 items-center gap-1.5">{actions}</div>
      )}
    </div>
  );
});
CardHead.displayName = 'CardHead';

type CardPadProps = React.HTMLAttributes<HTMLDivElement> & { flush?: boolean };

export const CardPad: React.FC<CardPadProps> = ({
  flush = false,
  className,
  children,
  ...rest
}) => (
  <div className={cn(flush ? 'p-0' : 'p-[var(--panel-inset)]', className)} {...rest}>
    {children}
  </div>
);

export const CardFoot: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  children,
  ...rest
}) => (
  <div className={cn('border-t border-border px-[var(--panel-inset)] py-3', className)} {...rest}>
    {children}
  </div>
);
