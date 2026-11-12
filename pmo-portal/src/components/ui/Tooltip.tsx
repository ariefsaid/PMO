import React, { useId, useState } from 'react';
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import { cn } from './cn';

export interface TooltipProps {
  /** Tooltip body (string or rich node, e.g. tabular key/value rows). */
  content: React.ReactNode;
  /** Optional bold title line. */
  title?: string;
  children: React.ReactElement;
  /** Let the trigger fill its row (a bar or a full-width line) instead of shrinking to its content. */
  block?: boolean;
  className?: string;
}

/**
 * Hover intent for every tooltip in the app. Base UI's default `timeout` (400ms) is the
 * "instant neighbour" window: once one tooltip has opened, its neighbours open at once,
 * marked `data-instant` so their entrance does not animate.
 */
export const TOOLTIP_OPEN_DELAY_MS = 400;

/**
 * Inverse dark tooltip surface on Base UI: opens on hover AND keyboard focus, closes on Escape/blur,
 * portals out of clipping ancestors and flips/clamps to the viewport. Non-interactive; never steals focus.
 */
export const Tooltip: React.FC<TooltipProps> = ({ content, title, children, block = false, className }) => {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <BaseTooltip.Root open={open} onOpenChange={setOpen}>
      {/* The wrapper keeps the trigger's layout box identical for every call site; focus reaches it by bubbling.
          No trigger-level delay: it overrides the app provider (delay ?? providerDelay ?? 600) and would
          re-introduce the instant flash the provider exists to stop. */}
      <BaseTooltip.Trigger
        render={<span className={block ? 'relative flex w-full' : 'relative inline-flex'} />}
      >
        {React.cloneElement(children as React.ReactElement<Record<string, unknown>>, { 'aria-describedby': open ? id : undefined })}
      </BaseTooltip.Trigger>
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side="bottom" sideOffset={8} collisionPadding={8} className="z-[900]">
          <BaseTooltip.Popup
            id={id}
            role="tooltip"
            className={cn(
              'tooltip-anim tooltip-surface pointer-events-none w-[280px] max-w-[calc(100vw-16px)] rounded-sm px-2 py-1 text-control',
              className,
            )}
            style={{ boxShadow: 'var(--shadow-xs)' }}
          >
            {title && <span className="mb-1 block font-semibold">{title}</span>}
            <span className="block text-tooltip-muted">{content}</span>
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
};
