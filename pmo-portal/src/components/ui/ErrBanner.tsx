import React from 'react';
import { cn } from './cn';
import { Icon } from './icons';
import { Button } from './Button';

export interface ErrBannerProps {
  title: React.ReactNode;
  sub?: React.ReactNode;
  /** Optional trailing action (e.g. "Review"). */
  action?: { label: string; onClick: () => void; disabled?: boolean };
  className?: string;
}

/**
 * A destructive-tinted banner for an EXPECTED, recoverable state — e.g. a week
 * returned for changes. It is `role="status"` (not `alert`): it is part of the
 * normal flow, announced politely, not a fetch failure (those use ListState's
 * `role="alert"`). The title uses the theme's destructive text token, which clears AA on the tint in both themes.
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
      {/* The theme's AA destructive text: a fixed deep red read 1.9:1 on dark surfaces. */}
      <div className="text-control font-semibold text-destructive-text">
        {title}
      </div>
      {sub && <div className="mt-px text-control text-muted-foreground">{sub}</div>}
    </div>
    {action && (
      <Button variant="outline" size="sm" onClick={action.onClick} disabled={action.disabled} className="shrink-0">
        {action.label}
      </Button>
    )}
  </div>
);
