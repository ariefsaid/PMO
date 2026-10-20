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
   *   • `framed` (default) — the 1px border + bg-card surface.
   *   • `bare`             — no frame: the section sits directly on the canvas
   *                          (heading + content), separated from neighbors by
   *                          whitespace + an optional hairline. CardHead's rule
   *                          stays as the section heading divider.
   */
  variant?: 'framed' | 'bare';
}

/**
 * The Flat-By-Default Rule: a card is defined by its 1px border + surface tone,
 * never a rest shadow. The state-lift shadow appears only on interactive hover.
 *
 * `variant="bare"` (content-over-containers) drops the frame so a section reads as
 * heading + content on the canvas — fewer boxes, more air (monochrome-calm reskin).
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
      variant === 'framed' && 'rounded-lg border border-border bg-card',
      clip && 'overflow-hidden',
      seam && 'rounded-b-none',
      interactive &&
        'transition-shadow duration-150 hover:shadow-[0_2px_10px_hsl(240_6%_10%/0.06)]',
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
  /**
   * Controls that live beside the title (buttons, links, menus, file inputs). They render OUTSIDE the
   * heading so its accessible name stays the title alone. `children` must be title text only.
   * `className` styles the header row (wrapper); `ref`/`id`/`tabIndex`/aria props go to the heading.
   */
  actions?: React.ReactNode;
};

export const CardHead = React.forwardRef<HTMLHeadingElement, CardHeadProps>(({
  level = 2,
  className,
  children,
  actions,
  ...rest
}, ref) => {
  const Heading = `h${level}` as const;
  return (
    <div
      className={cn(
        'flex items-center gap-2.5 border-b border-border px-4 py-[13px] text-sm font-semibold',
        className
      )}
    >
      <Heading ref={ref} className="flex min-w-0 flex-1 items-center gap-2.5" {...rest}>
        {children}
      </Heading>
      {actions != null && actions !== false && (
        <div className="ml-auto flex shrink-0 items-center gap-1.5">{actions}</div>
      )}
    </div>
  );
});
CardHead.displayName = 'CardHead';

export const CardPad: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  children,
  ...rest
}) => (
  <div className={cn('p-4', className)} {...rest}>
    {children}
  </div>
);
