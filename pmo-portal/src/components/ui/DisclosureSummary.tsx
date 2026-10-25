import React from 'react';
import { Icon } from './icons';
import { cn } from './cn';

/** Native disclosure label with a visible, consistent state cue and a phone-sized target. */
export const DisclosureSummary: React.FC<React.ComponentProps<'summary'>> = ({
  children,
  className,
  ...props
}) => (
  <summary
    className={cn(
      'flex min-h-11 list-none cursor-pointer items-center justify-between gap-3 text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden',
      className,
    )}
    {...props}
  >
    <span className="min-w-0">{children}</span>
    <Icon
      name="chev"
      aria-hidden="true"
      className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
    />
  </summary>
);

export default DisclosureSummary;
