import React from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/src/components/shadcn/dropdown-menu';
import { buttonClasses } from './buttonClasses';
import { Icon } from './icons';

export interface RecordMenuItem {
  key: string;
  label: string;
  onSelect: () => void;
  /** Destructive verb: tinted, and set apart from the safe items above it by a divider. */
  danger?: boolean;
  disabled?: boolean;
  testId?: string;
}

export interface RecordMenuProps {
  items: RecordMenuItem[];
  /** Accessible name of the trigger. */
  ariaLabel: string;
  /** Visible trigger text; omitted = the quiet ⋯ icon trigger. */
  label?: string;
  side?: 'top' | 'bottom';
  triggerClassName?: string;
}

/** Record action menu on Base UI Menu: focus, arrow keys, Escape, outside-press and positioning come from the library. */
export const RecordMenu: React.FC<RecordMenuProps> = ({ items, ariaLabel, label, side = 'bottom', triggerClassName }) => {
  if (items.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={ariaLabel}
        className={label ? buttonClasses('outline', 'sm', `gap-1 ${triggerClassName ?? ''}`) : buttonClasses('outline', 'icon', `touch-target ${triggerClassName ?? ''}`)}
      >
        {label ? (
          <>
            {label}
            <Icon name="chev" aria-hidden className="size-3.5 rotate-90" />
          </>
        ) : (
          <span aria-hidden className="text-base leading-none">⋯</span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side={side} className="w-auto min-w-48">
        {items.map((item, i) => (
          <React.Fragment key={item.key}>
            {item.danger && i > 0 && !items[i - 1].danger && <DropdownMenuSeparator />}
            <DropdownMenuItem
              data-testid={item.testId}
              variant={item.danger ? 'destructive' : 'default'}
              disabled={item.disabled}
              onClick={item.onSelect}
            >
              {item.label}
            </DropdownMenuItem>
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
