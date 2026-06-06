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

/** Wayfinding breadcrumb: muted links → foreground hover, bold ellipsized current. */
export const Breadcrumb: React.FC<BreadcrumbProps> = ({ parts, className }) => (
  <nav aria-label="Breadcrumb" className={cn('flex min-w-0 items-center gap-[7px] text-[13.5px]', className)}>
    {parts.map((part, i) => {
      const last = i === parts.length - 1;
      return (
        <React.Fragment key={i}>
          {i > 0 && (
            <span aria-hidden className="opacity-50 [&_svg]:size-3.5">
              <Icon name="chev" />
            </span>
          )}
          {last || !part.onClick ? (
            <span
              aria-current="page"
              className="max-w-[40ch] overflow-hidden text-ellipsis whitespace-nowrap font-semibold text-foreground"
            >
              {part.label}
            </span>
          ) : (
            <button
              type="button"
              onClick={part.onClick}
              className="whitespace-nowrap text-muted-foreground hover:text-foreground"
            >
              {part.label}
            </button>
          )}
        </React.Fragment>
      );
    })}
  </nav>
);
