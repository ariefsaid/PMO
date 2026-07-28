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
// sticky FormActions footer, and a post-submit error summary that moves focus to
// the first invalid field. Confirms before discarding a dirty form.
//
// Token-pure: white `popover` surface, 1px `border`, `rounded-lg`, the verbatim
// *Overlay* shadow, the desaturated near-black scrim (No-Pure-Black-Shadow).
//
// a11y: `role="dialog"` + `aria-modal` + `aria-labelledby`/`aria-describedby`;
// focus moves in on open, restores to the trigger on close; Esc + scrim close
// (blocked while loading); the error summary is `role="alert"`; the body is a
// real <form> so Enter submits; the app background goes `inert` while open.
//
// ⚑ Two WCAG Level A rules this component now encodes (2026-07-28 Discover pass,
//   graduated in `EntityFormModal.focus.test.tsx` + docs/decisions.md OD-FORM-A11Y):
//   1. BLUR-surfaced errors must NEVER move focus — only SUBMIT-surfaced ones do.
//      `useEntityForm` surfaces a field error on blur, so focusing "the first invalid
//      field whenever a summary is present" made every required field a keyboard trap
//      (WCAG 2.1.2): Tab → blur → error → refocus → back where you started.
//   2. A rejected SAVE gets a persistent in-dialog error region and its focus back
//      inside the dialog — a corner toast that self-dismisses is not evidence, and
//      focus left on <body> tabs into the background behind the dialog.
// ---------------------------------------------------------------------------

export interface ErrorSummaryItem {
  /** id of the invalid field's control (anchor + focus target). */
  fieldId: string;
  message: string;
}

/** A rejected mutation, already classified for humans (see `classifyMutationError`). */
export interface SubmitError {
  headline: string;
  detail?: string;
}

// ── Background inert (AC-A11Y-MODAL-001) ────────────────────────────────────
// `aria-modal="true"` is ADVISORY: it does not remove the background from the tab
// order, so focus that starts OUTSIDE the dialog (e.g. dumped on <body> by a failed
// save) walks straight into the app behind the scrim. `inert` on the app-shell root
// is the platform-native fix — it removes the background from the tab order AND the
// a11y tree AND blocks pointer events in one attribute. The refcount keeps two
// stacked dialogs from un-inerting the background when only the inner one closes.
// Scoped to the shell root (not <body>'s children) so the toast host and other
// body-level portals stay announceable.
const APP_SHELL_SELECTOR = '[data-app-shell="root"]';
let backgroundInertRefs = 0;

function acquireBackgroundInert(): () => void {
  const shell = document.querySelector<HTMLElement>(APP_SHELL_SELECTOR);
  if (!shell) return () => {};
  if (backgroundInertRefs === 0) shell.setAttribute('inert', '');
  backgroundInertRefs += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    backgroundInertRefs = Math.max(0, backgroundInertRefs - 1);
    if (backgroundInertRefs === 0) shell.removeAttribute('inert');
  };
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
  /**
   * The dialog-level error summary. Rendered — and allowed to move focus to its first item —
   * only ONCE THE USER HAS TRIED TO SUBMIT. A summary is a "you cannot save yet" verdict, so
   * before a save is attempted there is no verdict to report: `useEntityForm` surfaces a field
   * error on BLUR, and pairing that with a summary meant tabbing out of an empty required field
   * both scolded the user prematurely (the same message twice: inline AND in the banner) and,
   * because the banner moved focus, trapped them there (WCAG 2.1.2). Inline `error` on the field
   * itself is the correct pre-submit feedback and is unaffected.
   */
  errorSummary?: ErrorSummaryItem[];
  /**
   * A REJECTED SAVE (mutation failure) — distinct from `errorSummary`'s per-field
   * validation. Renders a persistent in-dialog error region and returns focus to it, so
   * the failure survives the toast's auto-dismiss and the keyboard user is not stranded
   * on <body>. The modal clears it when the user submits again, so a consumer never has
   * to; pass a FRESH object per failure (`classifyMutationError` returns one) — an
   * identical object reference is treated as "nothing new happened".
   */
  submitError?: SubmitError | null;
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
  submitError,
  width = 'sm',
  children,
}) => {
  const titleId = useId();
  const subId = useId();
  const summaryId = useId();
  const disabledReasonId = useId();

  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const saveErrorRef = useRef<HTMLDivElement>(null);

  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // Bumped on every submit attempt. The ONLY thing allowed to move focus to an invalid
  // field (see the header note: blur-surfaced errors must not).
  const [submitSeq, setSubmitSeq] = useState(0);
  const handledSubmitSeq = useRef(0);
  // The rejected-save error currently on screen. Mirrored from the `submitError` prop so
  // the modal can clear it itself the moment a new submit starts.
  const [visibleSaveError, setVisibleSaveError] = useState<SubmitError | null>(null);

  const hasSummary = !!errorSummary && errorSummary.length > 0;
  // The summary is a post-submit verdict (see the `errorSummary` prop doc): before the user has
  // tried to save, the field's own inline error is the whole story.
  const showSummary = hasSummary && submitSeq > 0;

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

  // AC-A11Y-MODAL-001: background inert while open. DECLARED BEFORE the focus effect on
  // purpose — React runs cleanups in declaration order, so the background is un-inerted
  // BEFORE the focus-restore cleanup below tries to focus the trigger (focusing an inert
  // element is a silent no-op).
  useEffect(() => {
    if (!open) return;
    return acquireBackgroundInert();
  }, [open]);

  // Focus: capture the trigger, move focus into the dialog on open, restore on close.
  // C-1: prefer the first FORM FIELD (input/select/textarea) over buttons so the close
  //      icon-button — which appears first in DOM order — is skipped on open.
  // C-2: when the consumer conditionally unmounts the modal (the MilestoneStrip pattern),
  //      the `open=false` branch never runs; a cleanup callback handles that case so focus
  //      always restores to the trigger regardless of how the modal is removed from the tree.
  useEffect(() => {
    if (!open) return;

    triggerRef.current = document.activeElement as HTMLElement | null;
    const root = dialogRef.current;
    // First real form field; fall back to any focusable; then the dialog container itself.
    const firstField = root?.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled]), textarea:not([disabled])');
    const firstAny = root?.querySelector<HTMLElement>('button:not([disabled]), [tabindex]:not([tabindex="-1"])');
    (firstField ?? firstAny ?? root)?.focus();

    // C-2 cleanup: restore focus when this effect re-runs (open→false) OR when the
    // component is unmounted while still open (conditional-render consumer).
    return () => {
      if (triggerRef.current) {
        triggerRef.current.focus();
        triggerRef.current = null;
      }
    };
  }, [open]);

  // AC-A11Y-FORM-001: move focus to the first invalid field ONLY for a SUBMIT-surfaced
  // summary. `submitSeq` is bumped in the form's submit handler and the validation state
  // lands in the same React batch, so the first render after a submit is the one that
  // both changes `submitSeq` and carries the summary. The generation is consumed either
  // way, so a LATER blur-surfaced summary can never inherit a stale "please focus" flag.
  useEffect(() => {
    if (submitSeq === handledSubmitSeq.current) return;
    handledSubmitSeq.current = submitSeq;
    if (hasSummary && errorSummary) {
      document.getElementById(errorSummary[0].fieldId)?.focus();
    }
  }, [submitSeq, hasSummary, errorSummary]);

  // Wrap the consumer's submit: open a new focus generation and retire the previous
  // save failure (the user is retrying — the old outcome is no longer the current one).
  const handleFormSubmit = useCallback(
    (e: React.FormEvent) => {
      setSubmitSeq((n) => n + 1);
      setVisibleSaveError(null);
      onSubmit(e);
    },
    [onSubmit],
  );

  // AC-ERR-001: a rejected save becomes persistent in-dialog evidence, and takes focus
  // back off <body> into the dialog. The region itself is the focus target (not the
  // submit button): it is what the user needs to read, and focusing a button risks an
  // accidental re-submit on the next Enter/Space.
  useEffect(() => {
    if (!submitError) return;
    setVisibleSaveError(submitError);
  }, [submitError]);

  useEffect(() => {
    if (visibleSaveError) saveErrorRef.current?.focus();
  }, [visibleSaveError]);

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
          <form onSubmit={handleFormSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-[18px] py-4">
              {visibleSaveError && (
                <div
                  ref={saveErrorRef}
                  data-testid="entity-modal-save-error"
                  role="alert"
                  aria-label="Save failed"
                  // Focus target for the rejected save — not in the Tab order, so it is
                  // reached deliberately (on failure) and never sits between fields.
                  tabIndex={-1}
                  className="mb-4 flex gap-2.5 rounded-md border border-destructive/30 bg-destructive/[0.07] px-3.5 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Icon name="alert" className="mt-px size-[17px] shrink-0 text-destructive" />
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-destructive-text">
                      {visibleSaveError.headline}
                    </div>
                    {visibleSaveError.detail && (
                      <p className="text-[12.5px] text-muted-foreground">{visibleSaveError.detail}</p>
                    )}
                    <p className="text-[12.5px] text-muted-foreground">
                      Nothing was saved — your entries are still here.
                    </p>
                  </div>
                </div>
              )}
              {showSummary && (
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
