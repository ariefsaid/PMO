import React from 'react';
import { Menu } from '@base-ui/react/menu';
import { buttonClasses } from './buttonClasses';
import { cn } from './cn';
import { Icon } from './icons';
import { menuItemClass, menuItemDanger, menuPopupClass, menuPopupOrigin, menuSeparatorClass } from './menuStyles';

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
  /** Accessible name of the trigger and the menu. */
  ariaLabel: string;
  /** Visible trigger text; omitted = the quiet ⋯ icon trigger. */
  label?: string;
  side?: 'top' | 'bottom';
  triggerClassName?: string;
}

/** Record action menu on Base UI Menu with the shared menu look: focus, arrow keys, Escape, outside-press and positioning come from the library. */
export const RecordMenu: React.FC<RecordMenuProps> = ({ items, ariaLabel, label, side = 'bottom', triggerClassName }) => {
  if (items.length === 0) return null;
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        aria-label={ariaLabel}
        className={label ? buttonClasses('outline', 'sm', cn('gap-1', triggerClassName)) : buttonClasses('outline', 'icon', cn('touch-target', triggerClassName))}
      >
        {label ? (
          <>
            {label}
            <Icon name="chev" aria-hidden className="size-3.5 rotate-90" />
          </>
        ) : (
          <span aria-hidden className="text-base leading-none">⋯</span>
        )}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side={side} align="end" sideOffset={side === 'top' ? 8 : 4} collisionPadding={12} className="z-50">
          <Menu.Popup aria-label={ariaLabel} className={cn(menuPopupClass, 'min-w-48')} style={menuPopupOrigin}>
            {items.map((item, i) => (
              <React.Fragment key={item.key}>
                {item.danger && i > 0 && !items[i - 1].danger && <Menu.Separator className={menuSeparatorClass} />}
                <Menu.Item
                  data-testid={item.testId}
                  disabled={item.disabled}
                  className={cn(menuItemClass, 'min-h-10', item.danger && menuItemDanger)}
                  onClick={item.onSelect}
                >
                  {item.label}
                </Menu.Item>
              </React.Fragment>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
};
