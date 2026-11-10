import React from 'react';
import { Menu } from '@base-ui/react/menu';
import { useTranslation } from 'react-i18next';
import { cn } from './cn';
import { Icon } from './icons';
import { buttonClasses } from './buttonClasses';
import { menuItemClass, menuPopupClass, menuPopupOrigin, menuSeparatorClass } from './menuStyles';

export interface RowMenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  /** Dimmed, announced disabled and unclickable — e.g. a per-row action already in flight (AC-PDF-011). */
  disabled?: boolean;
}

/**
 * Overflow row actions menu on Base UI Menu (focus, roving keys, dismissal, flip/clamp positioning come from the
 * library). Default trigger is a quiet ⋯ glyph; when `label` is passed it is a small outline button showing that text
 * (e.g. "Link…") — exported as `MenuButton` for one labelled action per row; `ariaLabel` names the trigger for its row.
 */
export const RowMenu: React.FC<{ items: RowMenuItem[]; label?: string; ariaLabel?: string }> = ({ items, label, ariaLabel }) => {
  const { t } = useTranslation('projects');
  return (
    // Keeps row-level click handlers (DataTable onActivate) from seeing trigger or item clicks.
    <div className="contents" onClick={(e) => e.stopPropagation()}>
      <Menu.Root>
        <Menu.Trigger
          aria-label={ariaLabel ?? (label ? undefined : t('table.rowActions', 'Row actions'))}
          // Always visible (AC-W2-IXD-006): reachable on touch + keyboard without a hover. Touch targets ≥44px
          // come from the `.touch-target` utility (coarse-pointer min hit area).
          className={label
            ? buttonClasses('outline', 'sm', 'touch-target gap-1')
            : 'touch-target grid size-7 place-items-center rounded-md text-muted-foreground transition-[opacity,background-color] hover:bg-accent hover:text-foreground'}
        >
          {label ? (
            <>
              {label}
              <Icon name="chev" aria-hidden className="size-3.5 rotate-90 text-muted-foreground" />
            </>
          ) : (
            <span aria-hidden className="text-base leading-none">
              ⋯
            </span>
          )}
        </Menu.Trigger>
        <Menu.Portal>
          {/* The toast stack is pinned to z-index 1000 (Toaster style) and may overlap the bottom row; keep row actions above it. */}
          <Menu.Positioner side="bottom" align="end" sideOffset={4} collisionPadding={16} style={{ zIndex: 1010 }}>
            <Menu.Popup className={menuPopupClass} style={menuPopupOrigin}>
              {items.map((item, i) => {
                // Spatially separate the first danger item from the non-danger items above it.
                const needsSep = item.danger && i > 0 && !items[i - 1].danger;
                return (
                  <React.Fragment key={`${i}-${item.label}`}>
                    {needsSep && <Menu.Separator className={menuSeparatorClass} />}
                    <Menu.Item
                      disabled={item.disabled}
                      onClick={item.onClick}
                      className={cn(menuItemClass, item.danger && 'text-destructive')}
                    >
                      {item.label}
                    </Menu.Item>
                  </React.Fragment>
                );
              })}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  );
};

export const MenuButton = RowMenu;
