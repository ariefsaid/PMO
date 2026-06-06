import React, { useId, useState } from 'react';
import { cn } from './cn';

export interface TooltipProps {
  /** Tooltip body (string or rich node, e.g. tabular key/value rows). */
  content: React.ReactNode;
  /** Optional bold title line. */
  title?: string;
  children: React.ReactElement;
  className?: string;
}

/**
 * Dark-surface tooltip (DESIGN.md `#tip`). Opens on hover AND focus so it is
 * keyboard-reachable (tooltip-keyboard). `role="tooltip"`, wired to the trigger
 * via aria-describedby. No focus stealing (it is non-interactive).
 */
export const Tooltip: React.FC<TooltipProps> = ({ content, title, children, className }) => {
  const [open, setOpen] = useState(false);
  const id = useId();

  const trigger = React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
    'aria-describedby': open ? id : undefined,
    onMouseEnter: () => setOpen(true),
    onMouseLeave: () => setOpen(false),
    onFocus: () => setOpen(true),
    onBlur: () => setOpen(false),
  });

  return (
    <span className="relative inline-flex">
      {trigger}
      {open && (
        <span
          role="tooltip"
          id={id}
          className={cn(
            'tooltip-surface pointer-events-none absolute left-1/2 top-full z-[900] mt-2 max-w-[280px] -translate-x-1/2 rounded-[7px] px-[11px] py-2 text-[12.5px] leading-snug',
            className
          )}
        >
          {title && <span className="mb-0.5 block font-bold">{title}</span>}
          <span className="block text-[hsl(0_0%_80%)]">{content}</span>
        </span>
      )}
    </span>
  );
};
