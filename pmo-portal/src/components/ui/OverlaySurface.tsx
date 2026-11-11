/** Visual-only shell classes shared by dialog facades; interaction stays with the owning engine. */
export const overlayBackdropClassName = 'confirm-scrim-anim absolute inset-0';
export const overlayBackdropStyle = {
  backgroundColor: 'hsl(var(--scrim) / var(--scrim-alpha))',
};

export const overlayDesktopContainerClassName =
  'confirm-anim relative z-[810] w-[calc(100%-32px)] rounded-overlay border border-border bg-popover origin-center motion-reduce:animate-none';

export const overlayDefaultDesktopWidthClassName = 'max-w-[var(--drawer-width)]';

export const overlayMobileContainerClassName =
  'confirm-sheet-anim relative z-[810] w-full rounded-t-overlay border border-border bg-popover motion-reduce:animate-none';

export const overlayHeaderClassName =
  'flex items-center gap-2 border-b border-border bg-secondary px-[var(--space-content-inset)] py-3';

export const overlayBodyClassName = 'px-[var(--space-content-inset)] py-[var(--space-content-inset)]';

export const overlayFooterClassName =
  'flex flex-wrap items-center justify-end gap-2 border-t border-border px-[var(--space-content-inset)] pt-2 pb-4';
