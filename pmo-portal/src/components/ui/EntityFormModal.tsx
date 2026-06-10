import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn';
import { Icon } from './icons';
import { Button } from './Button';
import { FormActions } from './FormFields';
import { ConfirmDialog } from './ConfirmDialog';

// ---------------------------------------------------------------------------
// EntityFormModal — the create / focused-edit composite (crud-components §2.2).
// Portal + scrim + focus-trap (reusing the ConfirmDialog machinery), a header
// (title + subtitle + ghost close icon-button), a scrollable form-body slot, a
// sticky FormActions footer, and an optional top error summary that moves focus
// to the first invalid field. Confirms before discarding a dirty form.
//
// Token-pure: white `popover` surface, 1px `border`, `rounded-lg`, the verbatim
// *Overlay* shadow, the desaturated near-black scrim (No-Pure-Black-Shadow).
//
// a11y: `role="dialog"` + `aria-modal` + `aria-labelledby`/`aria-describedby`;
// focus moves in on open, restores to the trigger on close; Esc + scrim close
// (blocked while loading); the error summary is `role="alert"`; the body is a
// real <form> so Enter submits.
// ---------------------------------------------------------------------------

export interface ErrorSummaryItem {
  /** id of the invalid field's control (anchor + focus target). */
  fieldId: string;
  message: string;
}

export interface EntityFormModalProps {
  open: boolean;
  title: string;
  subtitle?: string;
  /** Footer primary label, e.g. "Create deal". */
  submitLabel: string;
  cancelLabel?: string;
  /** Native form submit handler — call preventDefault + run your mutation. */
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
  /** Disable the submit (e.g. while the form is invalid). */
  submitDisabled?: boolean;
  /** Mutation in flight: footer spinner + Esc/scrim lockout. */
  loading?: boolean;
  /** Dirty => Cancel/Esc/scrim asks to confirm discard. */
  dirty?: boolean;
  /** When non-empty, renders the top error summary + moves focus to the first item. */
  errorSummary?: ErrorSummaryItem[];
  /** Max-width preset: 'sm' single-entity (520px) | 'lg' with line-items (640px). */
  width?: 'sm' | 'lg';
  children: React.ReactNode;
}

export const EntityFormModal: React.FC<EntityFormModalProps> = ({
  open,
  title,
  subtitle,
  submitLabel,
  cancelLabel,
  onSubmit,
  onClose,
  submitDisabled,
  loading = false,
  dirty = false,
  errorSummary,
  width = 'sm',
  children,
}) => {
  const titleId = useId();
  const subId = useId();
  const summaryId = useId();
  const disabledReasonId = useId();

  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const hasSummary = !!errorSummary && errorSummary.length > 0;

  // Intercept a close request: while loading => ignore; dirty => confirm; else close.
  const requestClose = useCallback(() => {
    if (loading) return;
    if (dirty) setConfirmDiscard(true);
    else onClose();
  }, [loading, dirty, onClose]);

  // Esc to close (through the same dirty/loading gate).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !confirmDiscard) {
        e.preventDefault();
        requestClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, confirmDiscard, requestClose]);

  // Focus: capture the trigger, move focus into the dialog on open, restore on close.
  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement as HTMLElement | null;
      // First focusable inside the dialog (a field), falling back to the dialog.
      const root = dialogRef.current;
      const first = root?.querySelector<HTMLElement>(
        'input, select, textarea, button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      (first ?? root)?.focus();
    } else if (triggerRef.current) {
      triggerRef.current.focus();
      triggerRef.current = null;
    }
  }, [open]);

  // Move focus to the first invalid field when an error summary appears.
  useEffect(() => {
    if (hasSummary && errorSummary) {
      const first = document.getElementById(errorSummary[0].fieldId);
      first?.focus();
    }
  }, [hasSummary, errorSummary]);

  // Focus trap within the dialog. Suspended while the discard ConfirmDialog is
  // open — that dialog runs its own trap and owns the focus cycle, so the form
  // trap must not fight it (would yank focus back into the form fields).
  const onTrapKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (confirmDiscard) return;
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
  }, [confirmDiscard]);

  if (!open) return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-[800] flex items-center justify-center p-4">
        <div
          data-testid="entity-modal-scrim"
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
          // While the discard ConfirmDialog is open it owns focus + AT; make the
          // form dialog inert so the background can't be tabbed into or read.
          inert={confirmDiscard || undefined}
          aria-hidden={confirmDiscard || undefined}
          className={cn(
            'confirm-anim relative z-[810] flex max-h-[85dvh] w-[calc(100%-32px)] flex-col rounded-lg border border-border bg-popover',
            'shadow-[0_10px_30px_hsl(240_10%_8%/0.16),0_2px_6px_hsl(240_10%_8%/0.08)]',
            'origin-center motion-reduce:animate-none',
            width === 'lg' ? 'max-w-[640px]' : 'max-w-[520px]',
          )}
        >
          {/* Header */}
          <div className="flex items-center gap-2.5 border-b border-border px-[18px] py-4">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-[16px] font-bold tracking-[-0.01em] text-popover-foreground">
                {title}
              </h2>
              {subtitle && (
                <p id={subId} className="mt-px text-[12.5px] text-muted-foreground">
                  {subtitle}
                </p>
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

          {/* Body (the form) */}
          <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-[18px] py-4">
              {hasSummary && (
                <div
                  id={summaryId}
                  role="alert"
                  aria-label="Form errors"
                  className="mb-4 flex gap-2.5 rounded-md border border-destructive/30 bg-destructive/[0.07] px-3.5 py-3"
                >
                  <Icon name="alert" className="mt-px size-[17px] shrink-0 text-destructive" />
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold" style={{ color: 'hsl(0 72% 42%)' }}>
                      Fix {errorSummary!.length} field{errorSummary!.length === 1 ? '' : 's'} before saving
                    </div>
                    {errorSummary!.map((item) => (
                      <a
                        key={item.fieldId}
                        href={`#${item.fieldId}`}
                        onClick={(e) => {
                          e.preventDefault();
                          document.getElementById(item.fieldId)?.focus();
                        }}
                        className="block text-[12.5px] text-destructive hover:underline"
                      >
                        {item.message}
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {children}
            </div>

            {/* Sticky footer */}
            <div className="border-t border-border px-[18px] py-3.5">
              {submitDisabled && (
                <span id={disabledReasonId} className="sr-only">
                  Complete all required fields (marked with an asterisk) to save.
                </span>
              )}
              <FormActions
                submitLabel={submitLabel}
                cancelLabel={cancelLabel}
                onCancel={requestClose}
                disabled={submitDisabled}
                loading={loading}
                submitDescribedBy={disabledReasonId}
              />
            </div>
          </form>
        </div>
      </div>

      {/* Dirty-discard confirm (nested ConfirmDialog). */}
      <ConfirmDialog
        open={confirmDiscard}
        tone="destructive"
        title="Discard your changes?"
        description="This form has unsaved changes. Discarding will lose them."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        onConfirm={() => {
          setConfirmDiscard(false);
          onClose();
        }}
        onCancel={() => setConfirmDiscard(false)}
      />
    </>,
    document.body,
  );
};

EntityFormModal.displayName = 'EntityFormModal';
