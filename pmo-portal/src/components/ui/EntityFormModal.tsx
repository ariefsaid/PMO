import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { useTranslation } from 'react-i18next';
import { cn } from './cn';
import { Icon } from './icons';
import { Button } from './Button';
import { FormActions } from './FormFields';
import { ConfirmDialog } from './ConfirmDialog';
import { acquireBackgroundInert } from './backgroundInert';
import {
  overlayBackdropClassName,
  overlayBackdropStyle,
  overlayBodyClassName,
  overlayDesktopContainerClassName,
  overlayDefaultDesktopWidthClassName,
  overlayFooterClassName,
  overlayHeaderClassName,
} from './OverlaySurface';

// ---------------------------------------------------------------------------
// EntityFormModal — the create / focused-edit composite (crud-components §2.2).
// A PMO facade over Base UI's Dialog (same engine as ConfirmDialog): the library owns
// the portal, focus trap, initial focus, focus return, Escape and scrim dismissal and
// the exit animation; this file owns the header (title + subtitle + ghost close
// icon-button), the scrollable form-body slot, the sticky FormActions footer, the
// post-submit error summary that moves focus to the first invalid field, and the
// confirm-before-discard gate on a dirty form.
//
// Token-pure: `popover` surface, 1px `border`, shared overlay radius, and the
// theme-aware scrim role.
//
// a11y: `role="dialog"` + `aria-modal` + labelled/described by title/subtitle; focus
// moves to the first form field on open; Esc + scrim close (blocked while loading);
// the error summary is `role="alert"`; the body is a real <form> so Enter submits; the
// app background goes `inert` while open.
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

/** Copy for the dirty-discard confirm; omit to keep the English default. */
export interface DiscardCopy {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
}

/** A rejected mutation, already classified for humans (see `classifyMutationError`). */
export interface SubmitError {
  headline: string;
  detail?: string;
  /** Optional way to fix it, rendered under the detail (e.g. a link to where the missing setting is recorded). */
  action?: React.ReactNode;
}

export interface EntityFormModalProps {
  open: boolean;
  title: string;
  subtitle?: string;
  /** Footer primary label, e.g. "Create deal". */
  submitLabel: string;
  cancelLabel?: string;
  /** Read-only dialog: only the footer submit (labelled Close/Done) dismisses. */
  hideCancel?: boolean;
  /** Native form submit handler — call preventDefault + run your mutation. */
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
  /** Disable the submit (e.g. while the form is invalid). */
  submitDisabled?: boolean;
  /** Drop the primary submit from the footer (Cancel/Done only). */
  hideSubmit?: boolean;
  /**
   * The screen-reader reason a disabled submit is described by. Defaults to the required-fields hint;
   * pass your own when the submit is disabled for another reason (e.g. an invalid value).
   */
  disabledReason?: string;
  /** Translated/specific copy for the dirty-discard confirm (default: English generic). */
  discardCopy?: DiscardCopy;
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
  /** Max-width preset: 'sm' single-entity (--drawer-width) | 'lg' with line-items (640px). */
  width?: 'sm' | 'lg';
  children: React.ReactNode;
}

export const EntityFormModal: React.FC<EntityFormModalProps> = ({
  open,
  title,
  subtitle,
  submitLabel,
  cancelLabel,
  hideCancel,
  onSubmit,
  onClose,
  submitDisabled,
  hideSubmit,
  disabledReason,
  discardCopy,
  loading = false,
  dirty = false,
  errorSummary,
  submitError,
  width = 'sm',
  children,
}) => {
  const { t } = useTranslation();
  const summaryId = useId();
  const disabledReasonId = useId();

  const popupRef = useRef<HTMLDivElement>(null);
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

  // AC-A11Y-MODAL-001: background inert while open (the library hides siblings of its own
  // portal; the app shell is a different subtree, so it is made inert here).
  useEffect(() => {
    if (!open) return;
    return acquireBackgroundInert();
  }, [open]);

  // Initial focus: the first real form field (the close icon-button comes first in DOM order and is
  // skipped); a `Combobox` picker is a form field too — its trigger is a role="combobox" button (#785).
  const initialFocus = useCallback(() => {
    triggerRef.current = document.activeElement as HTMLElement | null;
    const root = popupRef.current;
    const firstField = root?.querySelector<HTMLElement>(
      'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [role="combobox"]:not([disabled])',
    );
    const firstAny = root?.querySelector<HTMLElement>('button:not([disabled]), [tabindex]:not([tabindex="-1"])');
    return firstField ?? firstAny ?? root ?? true;
  }, []);

  // Focus return: to the opener. AC-A11Y-MODAL-002: after Discard the nested confirm leaves in the SAME commit and
  // still holds its share of the background `inert`, so focusing the opener now is a silent no-op and focus would
  // land on <body>; retry in a microtask once the background is live again.
  const finalFocus = useCallback(() => {
    const trigger = triggerRef.current;
    triggerRef.current = null;
    if (!trigger) return true;
    if (!trigger.closest('[inert]')) return trigger;
    queueMicrotask(() => {
      const stranded = !document.activeElement || document.activeElement === document.body;
      if (stranded && trigger.isConnected && !trigger.closest('[inert]')) trigger.focus();
    });
    return false;
  }, []);

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

  return (
    <>
      <Dialog.Root
        open={open}
        modal="trap-focus"
        onOpenChange={(next, details) => {
          if (next) return;
          // The consumer owns `open`: Esc / scrim only ASK to close (through the dirty/loading gate).
          // While the discard confirm is up it owns dismissal; a press inside it is "outside" here.
          details.cancel();
          if (!confirmDiscard) requestClose();
        }}
      >
        <Dialog.Portal>
          <div className="fixed inset-0 z-[800] flex items-center justify-center p-4">
            <Dialog.Backdrop
              data-testid="entity-modal-scrim"
              className={overlayBackdropClassName}
              style={overlayBackdropStyle}
            />
            <Dialog.Popup
              ref={popupRef}
              initialFocus={initialFocus}
              finalFocus={finalFocus}
              aria-modal="true"
              // While the discard ConfirmDialog is open it owns focus + AT; make the
              // form dialog inert so the background can't be tabbed into or read.
              inert={confirmDiscard || undefined}
              aria-hidden={confirmDiscard || undefined}
              className={cn(
                overlayDesktopContainerClassName,
                'flex max-h-[85dvh] flex-col',
                width === 'lg' ? 'max-w-[640px]' : overlayDefaultDesktopWidthClassName,
              )}
            >
              {/* Header */}
              <div className={overlayHeaderClassName}>
                <div className="min-w-0 flex-1">
                  <Dialog.Title className="text-control font-semibold text-popover-foreground">
                    {title}
                  </Dialog.Title>
                  {subtitle && (
                    <Dialog.Description render={<p />} className="mt-1 text-support text-muted-foreground">
                      {subtitle}
                    </Dialog.Description>
                  )}
                </div>
                <Button
                  variant="ghost"
                  iconOnly
                  aria-label={t('entityForm.close', 'Close')}
                  onClick={requestClose}
                  disabled={loading}
                >
                  <Icon name="x" />
                </Button>
              </div>

              {/* Body (the form) */}
              <form onSubmit={handleFormSubmit} className="flex min-h-0 flex-1 flex-col">
                <div className={cn('min-h-0 flex-1 overflow-y-auto', overlayBodyClassName)}>
                  {visibleSaveError && (
                    <div
                      ref={saveErrorRef}
                      data-testid="entity-modal-save-error"
                      role="alert"
                      aria-label={t('entityForm.saveFailed', 'Save failed')}
                      // Focus target for the rejected save — not in the Tab order, so it is
                      // reached deliberately (on failure) and never sits between fields.
                      tabIndex={-1}
                      className="mb-4 flex gap-2.5 rounded-md border border-destructive/30 bg-destructive/[0.07] px-3.5 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Icon name="alert" className="mt-px size-[17px] shrink-0 text-destructive" />
                      <div className="min-w-0">
                        <div className="text-control font-semibold text-destructive-text">
                          {visibleSaveError.headline}
                        </div>
                        {visibleSaveError.detail && (
                          <p className="text-support text-muted-foreground">{visibleSaveError.detail}</p>
                        )}
                        {visibleSaveError.action && (
                          <p className="text-support">{visibleSaveError.action}</p>
                        )}
                        <p className="text-support text-muted-foreground">
                          {t('entityForm.nothingSaved', 'Nothing was saved: your entries are still here.')}
                        </p>
                      </div>
                    </div>
                  )}
                  {showSummary && (
                    <div
                      id={summaryId}
                      role="alert"
                      aria-label={t('entityForm.formErrors', 'Form errors')}
                      className="mb-4 flex gap-2.5 rounded-md border border-destructive/30 bg-destructive/[0.07] px-3.5 py-3"
                    >
                      <Icon name="alert" className="mt-px size-[17px] shrink-0 text-destructive" />
                      <div className="min-w-0">
                        <div className="text-control font-semibold text-destructive-text">
                          {t('entityForm.fixFields', 'Fix {{count}} fields before saving', { count: errorSummary!.length })}
                        </div>
                        {errorSummary!.map((item) => (
                          <a
                            key={item.fieldId}
                            href={`#${item.fieldId}`}
                            onClick={(e) => {
                              e.preventDefault();
                              document.getElementById(item.fieldId)?.focus();
                            }}
                            className="block min-h-6 py-1 text-support text-destructive-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:min-h-6 [@media(pointer:coarse)]:min-h-11"
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
                <div className={overlayFooterClassName}>
                  {submitDisabled && !hideSubmit && (
                    <span id={disabledReasonId} className="sr-only">
                      {disabledReason ?? t('entityForm.completeRequired', 'Complete all required fields (marked with an asterisk) to save.')}
                    </span>
                  )}
                  <FormActions
                    submitLabel={submitLabel}
                    cancelLabel={cancelLabel ?? t('entityForm.cancel', 'Cancel')}
                    hideCancel={hideCancel}
                    onCancel={requestClose}
                    disabled={submitDisabled}
                    hideSubmit={hideSubmit}
                    loading={loading}
                    submitDescribedBy={disabledReasonId}
                  />
                </div>
              </form>
            </Dialog.Popup>
          </div>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Dirty-discard confirm (nested ConfirmDialog). */}
      <ConfirmDialog
        open={confirmDiscard}
        tone="destructive"
        title={discardCopy?.title ?? t('entityForm.discardTitle', 'Discard your changes?')}
        description={discardCopy?.description ?? t('entityForm.discardBody', 'This form has unsaved changes. Discarding will lose them.')}
        confirmLabel={discardCopy?.confirmLabel ?? t('entityForm.discard', 'Discard')}
        cancelLabel={discardCopy?.cancelLabel ?? t('entityForm.keepEditing', 'Keep editing')}
        onConfirm={() => {
          setConfirmDiscard(false);
          onClose();
        }}
        onCancel={() => setConfirmDiscard(false)}
      />
    </>
  );
};

EntityFormModal.displayName = 'EntityFormModal';
