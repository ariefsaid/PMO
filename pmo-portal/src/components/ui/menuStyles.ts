import type React from 'react';

/** Shared look for Base UI menus (DESIGN.md tokens); behaviour comes from the library. */
export const menuPopupClass =
  'menu-pop-anim motion-reduce:animate-none min-w-[160px] max-h-[var(--available-height)] overflow-y-auto rounded-lg border border-border bg-popover p-[5px] shadow-[0_10px_30px_hsl(240_10%_8%/0.16)] outline-none';
export const menuPopupOrigin = { '--menu-origin': 'var(--transform-origin)' } as React.CSSProperties;
export const menuItemClass =
  'flex h-8 w-full cursor-default items-center gap-2.5 rounded-md px-2.5 text-left text-[13.5px] outline-none data-[highlighted]:bg-accent data-[disabled]:cursor-not-allowed data-[disabled]:text-muted-foreground data-[disabled]:data-[highlighted]:bg-transparent';
export const menuSeparatorClass = 'my-1 h-px bg-border';
export const menuItemDanger = 'text-destructive';
