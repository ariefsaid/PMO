import React, { useCallback, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn';
import { Button } from './Button';
import { Icon } from './icons';
import { useIsDesktop } from './useIsDesktop';

export type ConfirmTone = 'default' | 'destructive';
export type ConfirmSurface = 'modal' | 'popover';

export interface ConfirmDialogProps {
  open: boolean;
  /** verb + object, e.g. "Mark deal as lost" */
  title: string;
  /** what will change, in plain language */
  description: React.ReactNode;
  /** verb + object, e.g. "Mark lost" */
  confirmLabel: string;
  /** default "Cancel" */
  cancelLabel?: string;
  /** 'destructive' -> red confirm + alertdialog + scrim; 'default' -> primary confirm */
  tone?: ConfirmTone;
  /** derived: destructive => 'modal', default => 'popover'. Overridable. */
  surface?: ConfirmSurface;
  /** confirm in-flight: spinner + disabled (reuses Button loading); blocks Esc/scrim close */
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * One reusable confirmation primitive for every DB-mutating call-site
 * (owner rule: nothing writes on a single click). DESIGN.md-tokened: white
 * `popover` surface, single 1px `border`, `rounded-lg` (8px spine), the
 * verbatim "Overlay" shadow, the One-Blue primary confirm, and the ONLY solid
 * `destructive` fill in the system (reserved for the destructive confirm button).
 *
 * Responsive layout (single-render — one DOM branch at a time via useIsDesktop):
 *   - Desktop (>=768px): centered modal overlay with scale+fade entrance.
 *   - Mobile (<768px): bottom-sheet anchored to the viewport bottom edge with
 *     slide-up entrance. The action row stacks full-width so confirm/cancel
 *     both sit in the natural thumb zone, fixing B-IMP-1 (primary actions at
 *     y=449-459 on a centered dialog, above the one-handed thumb zone).
 *
 * a11y contract (WCAG-AA): destructive => `role="alertdialog"`, default =>
 * `role="dialog"`; `aria-modal`, `aria-labelledby`, `aria-describedby` wired;
 * focus moves to Cancel on open (safe default), focus restored to the trigger
 * on close; Esc + scrim-click call onCancel (blocked while loading); the
 * confirm is disabled while loading so the mutation can't double-fire.
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'default',
  loading = false,
  onConfirm,
  onCancel,
}) => {
  const isDestructive = tone === 'destructive';
  const titleId = useId();
  const descId = useId();
  const isDesktop = useIsDesktop();

  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  // The element focused before the dialog opened — restored on close.
  const triggerRef = useRef<HTMLElement | null>(null);

  // Esc to close (blocked while loading to avoid orphaning an in-flight mutation).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) {
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, loading, onCancel]);

  // Focus management: capture the trigger, move focus to Cancel on open,
  // restore focus to the trigger on close (escape-routes / focus-management).
  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement as HTMLElement | null;
      // Cancel is the safe default focus, never the destructive confirm.
      cancelRef.current?.focus();
    } else if (triggerRef.current) {
      triggerRef.current.focus();
      triggerRef.current = null;
    }
  }, [open]);

  // Focus trap: keep Tab/Shift+Tab cycling within the dialog's two buttons.
  const onTrapKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const root = dialogRef.current;
    if (!root) return;
    const focusables = root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])',
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
  }, []);

  if (!open) return null;

  // ── Desktop: centered modal (scale+fade in 150ms ease-out) ──────────────
  // ── Mobile: bottom-sheet (slide-up in 220ms spring) ─────────────────────
  //
  // Single-render: exactly one branch is in the DOM (useIsDesktop reads
  // matchMedia synchronously at first paint — no flash). No aria-hidden
  // on either branch; the unrendered branch is simply absent.

  const dialog = isDesktop ? (
    // Desktop — centered, max-width-capped, rounded on all sides
    <div
      ref={dialogRef}
      role={isDestructive ? 'alertdialog' : 'dialog'}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      onKeyDown={onTrapKeyDown}
      className={cn(
        'confirm-anim relative z-[810] w-[calc(100%-32px)] max-w-[420px] rounded-lg border border-border bg-popover p-4',
        'shadow-[0_10px_30px_hsl(240_10%_8%/0.16),0_2px_6px_hsl(240_10%_8%/0.08)]',
        // scale+fade entrance (150ms ease-out via .confirm-anim); under
        // prefers-reduced-motion the global rule zeroes the duration AND this
        // variant drops the scale transform so it degrades to a crossfade.
        'origin-center motion-reduce:animate-none',
      )}
    >
      <div className="flex items-start gap-3">
        {isDestructive && (
          <span
            aria-hidden
            className="mt-px flex size-7 shrink-0 items-center justify-center rounded-md bg-destructive/10 [&_svg]:size-4 [&_svg]:text-destructive"
          >
            <Icon name="alert" />
          </span>
        )}
        <div className="flex flex-col gap-1.5">
          <h2 id={titleId} className="text-[18px] font-semibold leading-[1.3] text-popover-foreground">
            {title}
          </h2>
          <div id={descId} className="max-w-[60ch] text-[14px] leading-[1.45] text-foreground">
            {description}
          </div>
        </div>
      </div>

      <div
        data-testid="confirm-action-row"
        className="mt-4 flex justify-end gap-2"
      >
        <Button ref={cancelRef} variant="outline" disabled={loading} onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button
          variant={isDestructive ? 'destructive' : 'primary'}
          loading={loading}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  ) : (
    // Mobile — bottom-sheet: full-width, top corners rounded only, slide-up
    <div
      ref={dialogRef}
      role={isDestructive ? 'alertdialog' : 'dialog'}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      onKeyDown={onTrapKeyDown}
      className={cn(
        'confirm-sheet-anim relative z-[810] w-full rounded-t-lg border border-border bg-popover px-4 pt-4 pb-6',
        'shadow-[0_-4px_20px_hsl(240_10%_8%/0.12),0_-1px_4px_hsl(240_10%_8%/0.06)]',
        'motion-reduce:animate-none',
      )}
    >
      {/* Drag handle visual affordance — aria-hidden, purely decorative */}
      <div aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" />

      <div className="flex items-start gap-3">
        {isDestructive && (
          <span
            aria-hidden
            className="mt-px flex size-7 shrink-0 items-center justify-center rounded-md bg-destructive/10 [&_svg]:size-4 [&_svg]:text-destructive"
          >
            <Icon name="alert" />
          </span>
        )}
        <div className="flex flex-col gap-1.5">
          <h2 id={titleId} className="text-[18px] font-semibold leading-[1.3] text-popover-foreground">
            {title}
          </h2>
          <div id={descId} className="text-[14px] leading-[1.45] text-foreground">
            {description}
          </div>
        </div>
      </div>

      {/* Action row: stacked full-width buttons so confirm/cancel land in
          the natural thumb zone (bottom of screen on mobile). Confirm first
          (prominent primary action), Cancel below it as the escape hatch.
          touch-target on each button ensures >=44px hit area on coarse pointer. */}
      <div
        data-testid="confirm-action-row"
        className="mt-5 flex flex-col gap-2"
      >
        <Button
          variant={isDestructive ? 'destructive' : 'primary'}
          loading={loading}
          className="touch-target h-11 w-full text-[15px]"
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
        <Button
          ref={cancelRef}
          variant="outline"
          disabled={loading}
          className="touch-target h-11 w-full text-[15px]"
          onClick={onCancel}
        >
          {cancelLabel}
        </Button>
      </div>
    </div>
  );

  // Always render via a portal at the document root — never inside an
  // overflow container, so the dialog is never clipped (dropdown-clipping).
  // Desktop: centered fixed overlay. Mobile: bottom-anchored sheet.
  // Scrim is desaturated near-black at low alpha, not rgba(0,0,0,..)
  // (No-Pure-Black-Shadow Rule).
  return createPortal(
    <div
      className={cn(
        'fixed inset-0 z-[800] flex',
        isDesktop ? 'items-center justify-center p-4' : 'items-end',
      )}
    >
      <div
        data-testid="confirm-scrim"
        aria-hidden
        onClick={() => {
          if (!loading) onCancel();
        }}
        className="confirm-scrim-anim absolute inset-0 bg-foreground/40"
      />
      {dialog}
    </div>,
    document.body,
  );
};

ConfirmDialog.displayName = 'ConfirmDialog';
