import React from 'react';
import { cn } from './cn';
import { Icon } from './icons';
import { Button } from './Button';

export interface ErrBannerProps {
  title: React.ReactNode;
  sub?: React.ReactNode;
  /** Optional trailing action (e.g. "Review"). */
  action?: { label: string; onClick: () => void };
  className?: string;
}

/**
 * A destructive-tinted banner for an EXPECTED, recoverable state — e.g. a week
 * returned for changes. It is `role="status"` (not `alert`): it is part of the
 * normal flow, announced politely, not a fetch failure (those use ListState's
 * `role="alert"`). The deep-red darkened text clears AA on the tint.
 */
export const ErrBanner: React.FC<ErrBannerProps> = ({ title, sub, action, className }) => (
  <div
    role="status"
    className={cn(
      'mb-3.5 flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/[0.07] px-3.5 py-3',
      className
    )}
  >
    <Icon name="alert" className="mt-px size-[17px] shrink-0 text-destructive" />
    <div className="min-w-0 flex-1">
      <div className="text-[13.5px] font-semibold" style={{ color: 'hsl(0 72% 42%)' }}>
        {title}
      </div>
      {sub && <div className="mt-px text-[12.5px] text-muted-foreground">{sub}</div>}
    </div>
    {action && (
      <Button variant="outline" size="sm" onClick={action.onClick} className="shrink-0">
        {action.label}
      </Button>
    )}
  </div>
);
