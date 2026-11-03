import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { cn } from './cn';
import { Icon } from './icons';
import { buttonClasses } from './buttonClasses';

export interface RowMenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  /** Dimmed, announced disabled and unclickable — e.g. a per-row action already in flight (AC-PDF-011).
   *  WAI-ARIA menu pattern: rendered as `aria-disabled="true"`, NOT the HTML `disabled` attribute —
   *  a disabled button is unfocusable, so a disabled FIRST item would strand open-focus on the
   *  trigger (arrows/Escape dead). Staying focusable gives the roving focus a landing spot; the
   *  activate guard below makes Enter/click a no-op. */
  disabled?: boolean;
}

const GUTTER = 16; // matches the compact page gutter (DESIGN.md spacing role)
const MENU_GAP = 4; // `mt-1` equivalent between trigger and menu (DESIGN.md spacing.1)

/**
 * Overflow row actions menu. Default trigger is a quiet ⋯ glyph; when `label` is passed it is a
 * small outline button showing that text (e.g. "Link…") — exported as `MenuButton` for one labelled action
 * per row; `ariaLabel` names the trigger for its row (e.g. "Link PINV-1").
 */
export const RowMenu: React.FC<{ items: RowMenuItem[]; label?: string; ariaLabel?: string }> = ({ items, label, ariaLabel }) => {
  const { t } = useTranslation('projects');
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // -1 until the menu opens; open() lands focus on index 0.
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // The flat list of menuitem indices (separators are not focusable stops).
  const itemCount = items.length;

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    setActive(-1);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  // Position the portaled menu against the trigger: right-aligned, flip-up near
  // the viewport bottom, clamped within the gutters. Runs before paint so the
  // menu never flashes at (0,0).
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const compute = () => {
      const t = triggerRef.current;
      const menu = menuRef.current;
      if (!t || !menu) return;
      const r = t.getBoundingClientRect();
      const mw = menu.offsetWidth;
      const mh = menu.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // Right-align the menu's right edge to the trigger's right edge.
      let left = r.right - mw;
      // Clamp horizontally within the gutters.
      left = Math.min(left, vw - GUTTER - mw);
      left = Math.max(left, GUTTER);

      // Open downward by default; flip up if it would overflow the bottom,
      // then clamp when neither direction has enough room. maxHeight below
      // keeps the menu scrollable on unusually short viewports.
      const below = r.bottom + MENU_GAP;
      const above = r.top - MENU_GAP - mh;
      const flipUp = below + mh > vh - GUTTER && above >= GUTTER;
      const preferredTop = flipUp ? above : below;
      const top = Math.max(GUTTER, Math.min(preferredTop, vh - GUTTER - mh));

      setPos({ top, left });
    };
    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
    };
  }, [open]);

  // On open, move focus to the first menuitem.
  useEffect(() => {
    if (!open) return;
    setActive(0);
  }, [open]);

  // Keep the DOM focus on the active menuitem as the roving index changes.
  useEffect(() => {
    if (!open || active < 0) return;
    const el = menuRef.current?.querySelector<HTMLButtonElement>(
      `[data-menuitem-index="${active}"]`,
    );
    el?.focus();
  }, [open, active]);

  // Close on outside pointer-down (not on the trigger — that toggles).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false); // outside click: don't yank focus back to the trigger
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, close]);

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (a + 1) % itemCount);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a - 1 + itemCount) % itemCount);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(itemCount - 1);
    } else if (e.key === 'Tab') {
      // Menus are not internal tab-stops: Tab/Shift+Tab close + restore focus.
      close();
    }
    // Enter/Space activate the focused <button> natively (no handler needed).
  };

  const activate = (item: RowMenuItem) => {
    // Load-bearing since the aria-disabled switch: an aria-disabled <button> still fires
    // click (there is no HTML `disabled` to swallow it) — this guard is the no-op.
    if (item.disabled) return;
    item.onClick();
    close();
  };

  return (
    <div className="contents" onClick={(e) => e.stopPropagation()}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel ?? (label ? undefined : t('table.rowActions', 'Row actions'))}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        // B-4 (AC-W2-IXD-006): always-visible trigger — removed `opacity-0 group-hover:opacity-100`
        // which made the ⋯ undiscoverable on touch + keyboard. The trigger is now visible by
        // default so every row's actions are reachable without a hover event. Touch targets ≥44px
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
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-orientation="vertical"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={onMenuKeyDown}
            style={{
              position: 'fixed',
              top: pos?.top ?? -9999,
              left: pos?.left ?? -9999,
              // The fixed toast stack is z-[1000] and may overlap the bottom row;
              // keep row actions above it so the toast cannot intercept menu clicks.
              zIndex: 1010,
              visibility: pos ? 'visible' : 'hidden',
            }}
            className="min-w-[160px] max-h-[calc(100vh-32px)] overflow-y-auto rounded-lg border border-border bg-popover p-[5px] shadow-[0_10px_30px_hsl(240_10%_8%/0.16)]"
          >
            {items.map((item, i) => {
              // destructive-nav-separation: spatially separate the first danger item
              // from the non-danger items above it with a hairline divider (matches the
              // crud-companies.html `.menu-sep` above Delete). No separator when the
              // danger item is first/only, or for consecutive danger items.
              const needsSep = item.danger && i > 0 && !items[i - 1].danger;
              return (
                <React.Fragment key={item.label}>
                  {needsSep && <div role="separator" className="my-1 h-px bg-border" />}
                  <button
                    role="menuitem"
                    type="button"
                    aria-disabled={item.disabled || undefined}
                    tabIndex={i === active ? 0 : -1}
                    data-menuitem-index={i}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => activate(item)}
                    className={cn(
                      'flex h-8 w-full items-center rounded-md px-2.5 text-left text-[13.5px] hover:bg-accent',
                      item.danger && 'text-destructive',
                      item.disabled && 'cursor-not-allowed text-muted-foreground hover:bg-transparent'
                    )}
                  >
                    {item.label}
                  </button>
                </React.Fragment>
              );
            })}
          </div>,
          document.body
        )}
    </div>
  );
};

export const MenuButton = RowMenu;
