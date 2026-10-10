import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn';

export interface TooltipProps {
  /** Tooltip body (string or rich node, e.g. tabular key/value rows). */
  content: React.ReactNode;
  /** Optional bold title line. */
  title?: string;
  children: React.ReactElement;
  className?: string;
}

type TooltipPosition = { left: number; top: number; placement: 'top' | 'bottom' };
const GUTTER = 8;
const GAP = 8;

/**
 * Dark-surface tooltip (DESIGN.md `#tip`). Opens on hover AND focus so it is
 * keyboard-reachable. Portals out of clipping ancestors and clamps its preferred
 * 280px width/position to the viewport. It is non-interactive and never steals focus.
 */
export const Tooltip: React.FC<TooltipProps> = ({ content, title, children, className }) => {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<TooltipPosition | null>(null);
  const id = useId();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (!open) return;

    const placeTooltip = () => {
      const anchor = triggerRef.current?.getBoundingClientRect();
      const tooltip = tooltipRef.current;
      if (!anchor || !tooltip) return;

      const width = tooltip.getBoundingClientRect().width;
      const height = tooltip.getBoundingClientRect().height;
      const maxLeft = Math.max(GUTTER, window.innerWidth - width - GUTTER);
      const left = Math.min(maxLeft, Math.max(GUTTER, anchor.left + anchor.width / 2 - width / 2));
      const below = anchor.bottom + GAP;
      const placement = below + height <= window.innerHeight - GUTTER ? 'bottom' : 'top';
      const top = placement === 'bottom'
        ? below
        : Math.max(GUTTER, anchor.top - height - GAP);

      setPosition({ left, top, placement });
    };

    placeTooltip();
    window.addEventListener('resize', placeTooltip);
    window.addEventListener('scroll', placeTooltip, true);
    return () => {
      window.removeEventListener('resize', placeTooltip);
      window.removeEventListener('scroll', placeTooltip, true);
    };
  }, [open, content, title]);

  const trigger = React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
    'aria-describedby': open ? id : undefined,
    onMouseEnter: (event: React.MouseEvent<HTMLElement>) => {
      (children.props as React.HTMLAttributes<HTMLElement>).onMouseEnter?.(event);
      setOpen(true);
    },
    onMouseLeave: (event: React.MouseEvent<HTMLElement>) => {
      (children.props as React.HTMLAttributes<HTMLElement>).onMouseLeave?.(event);
      setOpen(false);
    },
    onFocus: (event: React.FocusEvent<HTMLElement>) => {
      (children.props as React.HTMLAttributes<HTMLElement>).onFocus?.(event);
      setOpen(true);
    },
    onBlur: (event: React.FocusEvent<HTMLElement>) => {
      (children.props as React.HTMLAttributes<HTMLElement>).onBlur?.(event);
      setOpen(false);
    },
  });

  return (
    <>
      <span ref={triggerRef} className="relative inline-flex">
        {trigger}
      </span>
      {open && typeof document !== 'undefined' && createPortal(
        <span
          ref={tooltipRef}
          role="tooltip"
          id={id}
          data-placement={position?.placement ?? 'bottom'}
          className={cn(
            'tooltip-surface pointer-events-none fixed z-[900] w-[280px] max-w-[calc(100vw-16px)] rounded-[7px] px-3 py-2 text-[12.5px] leading-snug',
            className,
          )}
          style={{
            left: position?.left ?? GUTTER,
            top: position?.top ?? GUTTER,
            visibility: position ? 'visible' : 'hidden',
          }}
        >
          {title && <span className="mb-0.5 block font-bold">{title}</span>}
          <span className="block text-[hsl(var(--tooltip-muted))]">{content}</span>
        </span>,
        document.body,
      )}
    </>
  );
};
