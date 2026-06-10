import React from 'react';
import { cn } from '@/src/components/ui/cn';
import { Icon } from '@/src/components/ui/icons';

export interface BreadcrumbPart {
  label: string;
  /** When present, the part is a clickable link; the last part omits it (current). */
  onClick?: () => void;
}

export interface BreadcrumbProps {
  parts: BreadcrumbPart[];
  className?: string;
}

/**
 * Wayfinding breadcrumb: muted links → foreground hover, bold ellipsized current.
 *
 * C3 mobile truncation (AC-IXD-MOBILE-W4-C3 C3-10):
 *   At ≤921px (the shell's rail-collapse breakpoint), show ONLY the current crumb
 *   truncated to max-w-[20ch]. Parent crumb links are hidden (the in-page BackBar
 *   already carries the parent escape on detail pages; the drawer carries top-level
 *   nav). This keeps the top bar tidy at 375px without sacrificing wayfinding.
 *   Desktop (>921px) is unchanged: all parts show, current truncates to max-w-[40ch].
 */
export const Breadcrumb: React.FC<BreadcrumbProps> = ({ parts, className }) => (
  <nav aria-label="Breadcrumb" className={cn('flex min-w-0 items-center gap-[7px] text-[13.5px]', className)}>
    {parts.map((part, i) => {
      const last = i === parts.length - 1;
      return (
        <React.Fragment key={i}>
          {i > 0 && (
            // C3: the separator is hidden at mobile alongside its parent link.
            <span
              aria-hidden
              className="opacity-50 max-[921px]:hidden [&_svg]:size-3.5"
            >
              <Icon name="chev" />
            </span>
          )}
          {last || !part.onClick ? (
            <span
              aria-current="page"
              // C3: at ≤921px truncate harder (20ch) — only the current crumb
              // shows; at desktop full width allows 40ch before ellipsis.
              className="max-w-[40ch] overflow-hidden text-ellipsis whitespace-nowrap font-semibold text-foreground max-[921px]:max-w-[20ch]"
            >
              {part.label}
            </span>
          ) : (
            // C3: parent crumb links are hidden at ≤921px — the BackBar and
            // drawer nav provide those escape routes on mobile.
            <button
              type="button"
              onClick={part.onClick}
              className="whitespace-nowrap text-muted-foreground hover:text-foreground max-[921px]:hidden"
            >
              {part.label}
            </button>
          )}
        </React.Fragment>
      );
    })}
  </nav>
);
