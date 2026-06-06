import React from 'react';
import { cn } from './cn';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Interactive cards get a hover state-lift; static cards stay flat. */
  interactive?: boolean;
  /** Clip overflow (for seamed table assemblies, rounded media). */
  clip?: boolean;
  /** Sits directly above a toolbar+table — square the bottom corners. */
  seam?: boolean;
}

/**
 * The Flat-By-Default Rule: a card is defined by its 1px border + surface tone,
 * never a rest shadow. The state-lift shadow appears only on interactive hover.
 */
export const Card: React.FC<CardProps> = ({
  interactive = false,
  clip = false,
  seam = false,
  className,
  children,
  ...rest
}) => (
  <div
    className={cn(
      'rounded-lg border border-border bg-card',
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

export const CardHead: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  children,
  ...rest
}) => (
  <div
    className={cn(
      'flex items-center gap-2.5 border-b border-border px-4 py-[13px] text-sm font-semibold',
      className
    )}
    {...rest}
  >
    {children}
  </div>
);

export const CardPad: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  children,
  ...rest
}) => (
  <div className={cn('p-4', className)} {...rest}>
    {children}
  </div>
);
