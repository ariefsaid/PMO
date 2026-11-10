import React from 'react';
import { useTranslation } from 'react-i18next';
import { Popover, PopoverContent, PopoverTrigger } from '@/src/components/shadcn/popover';
import { Icon } from './icons';
import { cn } from './cn';

export interface HelpPopoverProps {
  /** What the help is about; names the button ("About {{subject}}"). */
  subject: string;
  children: React.ReactNode;
  className?: string;
}

/** A `?` button whose popover holds the explanation. Focus, Escape, outside-press and placement come from Base UI. */
export const HelpPopover: React.FC<HelpPopoverProps> = ({ subject, children, className }) => {
  const { t } = useTranslation('dashboard');
  return (
    <Popover>
      <PopoverTrigger
        aria-label={t('helpPopover.label', 'About {{subject}}', { subject })}
        className={cn('touch-target grid size-6 shrink-0 cursor-help place-items-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring [&_svg]:size-3.5', className)}
      >
        <Icon name="help" />
      </PopoverTrigger>
      <PopoverContent align="start" className="max-w-[min(20rem,calc(100vw-2rem))] text-[12.5px] leading-snug">{children}</PopoverContent>
    </Popover>
  );
};
