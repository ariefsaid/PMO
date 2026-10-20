/** Visual-only shell classes shared by dialog facades; interaction stays with the owning engine. */
export const overlayBackdropClassName = 'confirm-scrim-anim absolute inset-0 bg-foreground/40';

export const overlayDesktopContainerClassName =
  'confirm-anim relative z-[810] w-[calc(100%-32px)] max-w-[420px] rounded-lg border border-border bg-popover p-4 shadow-[0_10px_30px_hsl(240_10%_8%/0.16),0_2px_6px_hsl(240_10%_8%/0.08)] origin-center motion-reduce:animate-none';

export const overlayMobileContainerClassName =
  'confirm-sheet-anim relative z-[810] w-full rounded-t-lg border border-border bg-popover px-4 pt-4 pb-6 shadow-[0_-4px_20px_hsl(240_10%_8%/0.12),0_-1px_4px_hsl(240_10%_8%/0.06)] motion-reduce:animate-none';
