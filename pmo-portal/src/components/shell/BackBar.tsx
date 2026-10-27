import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/src/components/ui/cn';
import { Icon } from '@/src/components/ui/icons';

export interface BackBarProps {
  /** Parent label, e.g. "Projects". */
  label: string;
  onBack: () => void;
  className?: string;
  /**
   * Show the bar only at phone width (<=920px, where the top-bar breadcrumb is not
   * visible). Loading / error / not-found states of record pages set this so they match
   * the loaded state and never show a redundant Back bar beside the breadcrumb on desktop.
   */
  phoneOnly?: boolean;
}

/**
 * Page-drill return affordance (distinct from the breadcrumb). 30px outline btn. The whole
 * sentence is translated (word order differs by language), so pass an already-localized `label`.
 */
export const BackBar: React.FC<BackBarProps> = ({ label, onBack, className, phoneOnly }) => {
  const { t } = useTranslation();
  return (
    <div className={cn('mb-3.5 items-center gap-2.5', phoneOnly ? 'hidden max-[920px]:flex' : 'flex', className)}>
      <button
        type="button"
        onClick={onBack}
        className="inline-flex h-[30px] items-center gap-[7px] rounded-lg border border-input bg-background pl-2 pr-[11px] text-[13px] font-medium text-foreground transition-colors hover:bg-accent active:translate-y-px [&_svg]:size-[15px]"
      >
        <Icon name="back" />
        {t('shell.backBar.label', 'Back to {{label}}', { label })}
      </button>
    </div>
  );
};
