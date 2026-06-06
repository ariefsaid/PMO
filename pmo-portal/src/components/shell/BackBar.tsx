import React from 'react';
import { cn } from '@/src/components/ui/cn';
import { Icon } from '@/src/components/ui/icons';

export interface BackBarProps {
  /** Parent label, e.g. "Projects". */
  label: string;
  onBack: () => void;
  className?: string;
}

/** Page-drill return affordance (distinct from the breadcrumb). 30px outline btn. */
export const BackBar: React.FC<BackBarProps> = ({ label, onBack, className }) => (
  <div className={cn('mb-3.5 flex items-center gap-2.5', className)}>
    <button
      type="button"
      onClick={onBack}
      className="inline-flex h-[30px] items-center gap-[7px] rounded-lg border border-input bg-background pl-2 pr-[11px] text-[13px] font-medium text-foreground transition-colors hover:bg-accent active:translate-y-px [&_svg]:size-[15px]"
    >
      <Icon name="back" />
      Back to {label}
    </button>
  </div>
);
