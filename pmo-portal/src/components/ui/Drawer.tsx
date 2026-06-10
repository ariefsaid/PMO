import React, { useCallback, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn';
import { Icon } from './icons';
import { Button } from './Button';

// ---------------------------------------------------------------------------
// Drawer — a right-side quick-view sheet (Wave-5 Cluster 6, D11/D12).
//
// A read-first "look at this record" surface for dense list rows: click a row,
// the panel slides in from the right over a scrim, the list stays in place
// behind it. Sibling to EntityFormModal — it REUSES EntityFormModal's exact,
// proven overlay machinery, re-housed as an edge-anchored panel:
//   - createPortal(…, document.body) — never clipped by a table overflow box
//   - the desaturated near-black scrim (No-Pure-Black-Shadow Rule), Esc + scrim
//     close (blocked while `loading`)
//   - focus capture on open / restore to the triggering row-button on close
//   - a Tab focus-trap, suspended while a nested ConfirmDialog/Modal owns focus
//     (the panel goes `inert` + aria-hidden — the same pattern EntityFormModal
//     uses for its discard dialog)
//   - role="dialog" + aria-modal + aria-labelledby/aria-describedby
//
// Token-pure: white `popover` surface, a single left `border` hairline seam
// (Single-Border Rule), the verbatim *Overlay* shadow on the floating edge,
// the `subheading`/`muted-foreground` header, a ghost close icon-button. No new
// token. Slides in via `confirm-anim` discipline; motion-reduce → crossfade.
//
// Same overlay z-band as the modal: scrim z-[800], panel z-[810].
// ---------------------------------------------------------------------------

export interface DrawerProps {
  open: boolean;
  /** Record name — the drawer's accessible name (aria-labelledby → the h2). */
  title: React.ReactNode;
  /** Optional subtitle (e.g. the type/status pill) → aria-describedby. */
  subtitle?: React.ReactNode;
  onClose: () => void;
  /** Mutation in flight: Esc/scrim lockout + close button disabled. */
  loading?: boolean;
  /**
   * A nested ConfirmDialog/EntityFormModal is open and owns focus + AT. While
   * true the drawer panel is made `inert` + aria-hidden and its own focus-trap
   * is suspended (so it doesn't fight the nested dialog's trap). Mirrors
   * EntityFormModal's discard-dialog pattern.
   */
  nestedOpen?: boolean;
  /** Width preset: 'sm' = 420px (default) | 'lg' = min(560px, 92vw). */
  width?: 'sm' | 'lg';
  /** Optional border-top footer slot for secondary entry points. */
  footer?: React.ReactNode;
  children: React.ReactNode;
}

export const Drawer: React.FC<DrawerProps> = ({
  open,
  title,
  subtitle,
  onClose,
  loading = false,
  nestedOpen = false,
  width = 'sm',
  footer,
  children,
}) => {
  const titleId = useId();
  const subId = useId();

  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  // Close request through the loading gate (mutation in flight => ignore).
  const requestClose = useCallback(() => {
    if (loading) return;
    onClose();
  }, [loading, onClose]);

  // Esc to close (through the loading gate). Suspended while a nested dialog is
  // up — that dialog handles its own Esc and owns the close cycle.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !nestedOpen) {
        e.preventDefault();
        requestClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, nestedOpen, requestClose]);

  // Focus: capture the trigger, move focus into the panel on open, restore on
  // close. Works for BOTH close patterns:
  //   • re-render to open=false (EntityFormModal-style): the else-if branch fires.
  //   • UNMOUNT (conditional-render consumers: {company && <CompanyDrawer/>}): the
  //     effect cleanup fires and restores focus; the else-if never runs.
  // Both paths call triggerRef.current.focus() exactly once; the cleanup nulls the
  // ref afterward to prevent double-focus if the component somehow re-opens.
  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement as HTMLElement | null;
      const root = dialogRef.current;
      const first = root?.querySelector<HTMLElement>(
        'input, select, textarea, button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      );
      (first ?? root)?.focus();
      // Cleanup: runs on unmount (conditional-render consumers) OR when open
      // changes to false (re-render consumers). Either way, focus is restored
      // to the captured trigger before the drawer disappears.
      return () => {
        if (triggerRef.current) {
          triggerRef.current.focus();
          triggerRef.current = null;
        }
      };
    } else if (triggerRef.current) {
      // Re-render path (open=false): the cleanup above already fired and nulled
      // the ref, so this branch handles the edge case where the effect runs
      // without the cleanup having fired (e.g. if open was never true in this
      // mount cycle and someone set a triggerRef manually). Guard is harmless.
      triggerRef.current.focus();
      triggerRef.current = null;
    }
  }, [open]);

  // Focus trap within the panel. Suspended while a nested dialog is open — that
  // dialog runs its own trap and owns the focus cycle, so the drawer trap must
  // not fight it (would yank focus back into the drawer body).
  const onTrapKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (nestedOpen) return;
      if (e.key !== 'Tab') return;
      const root = dialogRef.current;
      if (!root) return;
      const focusables = root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [nestedOpen],
  );

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[800] flex justify-end">
      <div
        data-testid="drawer-scrim"
        aria-hidden
        onClick={requestClose}
        className="confirm-scrim-anim absolute inset-0 bg-foreground/40"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? subId : undefined}
        tabIndex={-1}
        onKeyDown={onTrapKeyDown}
        // While a nested ConfirmDialog/Modal is open it owns focus + AT; make
        // the panel inert so the background can't be tabbed into or read.
        inert={nestedOpen || undefined}
        aria-hidden={nestedOpen || undefined}
        className={cn(
          // Edge-anchored: full-height right panel, square against the viewport
          // edge (inner cards keep their own radius); the left border is the
          // only seam (Single-Border Rule), the *Overlay* shadow floats it.
          'drawer-anim relative z-[810] flex h-full flex-col border-l border-border bg-popover',
          'shadow-[0_10px_30px_hsl(240_10%_8%/0.16),0_2px_6px_hsl(240_10%_8%/0.08)]',
          'motion-reduce:animate-none',
          width === 'lg' ? 'w-[min(560px,92vw)]' : 'w-[min(420px,92vw)]',
        )}
      >
        {/* Header */}
        <div className="flex items-start gap-2.5 border-b border-border px-[18px] py-4">
          <div className="min-w-0 flex-1">
            <h2
              id={titleId}
              className="truncate text-[16px] font-bold tracking-[-0.01em] text-popover-foreground"
            >
              {title}
            </h2>
            {subtitle && (
              <div id={subId} className="mt-1.5 text-[12.5px] text-muted-foreground">
                {subtitle}
              </div>
            )}
          </div>
          <Button
            variant="ghost"
            iconOnly
            aria-label="Close"
            onClick={requestClose}
            disabled={loading}
          >
            <Icon name="x" />
          </Button>
        </div>

        {/* Body (scrollable) */}
        <div className="min-h-0 flex-1 overflow-y-auto px-[18px] py-4">{children}</div>

        {/* Optional footer action row */}
        {footer && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border px-[18px] py-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};

Drawer.displayName = 'Drawer';
