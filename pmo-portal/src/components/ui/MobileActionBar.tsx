import React, { useLayoutEffect, useRef } from 'react';
import { cn } from './cn';

const activeBarHeights = new Map<HTMLElement, number>();

function publishMaxHeight(): void {
  const height = Math.max(0, ...activeBarHeights.values());
  if (height > 0) document.documentElement.style.setProperty('--mobile-action-bar-height', `${height}px`);
  else document.documentElement.style.removeProperty('--mobile-action-bar-height');
}

/**
 * Publisher wrapper for a fixed, bottom-anchored mobile primary-action bar.
 * Its rendered height (including padding such as the device safe-area inset) is
 * shared with the toast host. Visibility is determined by actual layout, so CSS
 * breakpoints and conditional rendering remain the source of truth.
 *
 * Concurrent bars publish their maximum occupied height; every publisher is
 * removed on unmount and a hidden (`display: none`) bar publishes zero.
 */
export const MobileActionBar: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  children,
  className,
  ...props
}) => {
  const barRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;

    const update = () => {
      activeBarHeights.set(bar, bar.getBoundingClientRect().height);
      publishMaxHeight();
    };

    update();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(update);
      observer.observe(bar);
      return () => {
        observer.disconnect();
        activeBarHeights.delete(bar);
        publishMaxHeight();
      };
    }

    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('resize', update);
      activeBarHeights.delete(bar);
      publishMaxHeight();
    };
  }, []);

  return (
    <div
      {...props}
      ref={barRef}
      data-mobile-action-bar=""
      className={cn(className)}
    >
      {children}
    </div>
  );
};
