import React, { useCallback, useEffect, useId, useRef } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { useTranslation } from 'react-i18next';
import { cn } from './cn';
import { Button } from './Button';
import { Icon } from './icons';
import { useIsDesktop } from './useIsDesktop';
import { acquireBackgroundInert } from './backgroundInert';
import {
  overlayBackdropClassName,
  overlayBackdropStyle,
  overlayBodyClassName,
  overlayDesktopContainerClassName,
  overlayDefaultDesktopWidthClassName,
  overlayFooterClassName,
  overlayHeaderClassName,
  overlayMobileContainerClassName,
} from './OverlaySurface';

export type ConfirmTone = 'default' | 'destructive';

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
  /** confirm in-flight: spinner + disabled (reuses Button loading); blocks Esc/scrim close */
  loading?: boolean;
  /** Gate the confirm button — for a dialog that hosts a required input (e.g. an attestation reason).
   *  Cancel/Esc/scrim are NEVER blocked by this: the escape hatch stays open. */
  confirmDisabled?: boolean;
  /** Put the safe cancel action before confirm in the mobile sheet. */
  cancelFirstOnMobile?: boolean;
  /** Where focus lands on open: Cancel (default, the safe choice) or a field the dialog hosts (ReasonDialog's reason box). */
  initialFocus?: () => HTMLElement | null;
  /** Consumer-owned focus destination if the opener is removed while the dialog is open. */
  restoreFocusFallback?: () => HTMLElement | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Stable PMO confirmation facade backed by Base UI's focus and dismissal engine. */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel: cancelLabelProp,
  tone = 'default',
  loading = false,
  confirmDisabled = false,
  cancelFirstOnMobile = false,
  initialFocus,
  restoreFocusFallback,
  onConfirm,
  onCancel,
}) => {
  const { t } = useTranslation();
  const cancelLabel = cancelLabelProp ?? t('entityForm.cancel', 'Cancel');
  const isDestructive = tone === 'destructive';
  const titleId = useId();
  const descId = useId();
  const isDesktop = useIsDesktop();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const setCancelRef = useCallback((element: HTMLButtonElement | null) => {
    cancelRef.current = element;
  }, []);
  const triggerRef = useRef<HTMLElement | null>(null);
  const fallbackRef = useRef(restoreFocusFallback);
  fallbackRef.current = restoreFocusFallback;

  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement as HTMLElement | null;
      return;
    }
    const trigger = triggerRef.current;
    if (!trigger) return;
    triggerRef.current = null;
    const target = trigger.isConnected
      ? trigger
      : fallbackRef.current?.() ?? document.querySelector<HTMLElement>('[data-app-shell="root"] main');
    target?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    triggerRef.current = null;
    window.setTimeout(() => {
      const target = trigger.isConnected
        ? trigger
        : fallbackRef.current?.() ?? document.querySelector<HTMLElement>('[data-app-shell="root"] main');
      target?.focus({ preventScroll: true });
    }, 0);
  }, []);

  useEffect(() => {
    if (!open) return;
    return acquireBackgroundInert();
  }, [open]);

  const handleOpenChange = (nextOpen: boolean, details: { cancel: () => void }) => {
    if (nextOpen) return;
    if (loading) {
      details.cancel();
      return;
    }
    onCancel();
  };

  return (
    <Dialog.Root open={open} modal="trap-focus" onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <div className={cn('fixed inset-0 z-[800] flex', isDesktop ? 'items-center justify-center p-4' : 'items-end')}>
        <Dialog.Backdrop
          data-testid="confirm-scrim"
          className={cn('z-[800]', overlayBackdropClassName)}
          style={overlayBackdropStyle}
        />
        <Dialog.Popup
          initialFocus={initialFocus ? () => initialFocus() ?? cancelRef.current : () => cancelRef.current}
          finalFocus={false}
          onKeyDown={(event) => {
            if (event.key === 'Escape') event.stopPropagation();
          }}
          role={isDestructive ? 'alertdialog' : 'dialog'}
          aria-labelledby={titleId}
          aria-describedby={descId}
          aria-modal="true"
          className={cn(
            isDesktop ? overlayDesktopContainerClassName : overlayMobileContainerClassName,
            isDesktop && overlayDefaultDesktopWidthClassName,
            'relative',
          )}
        >
          {!isDesktop && <div aria-hidden className="mx-auto mt-3 mb-3 h-1 w-10 rounded-full bg-border" />}
          <div className={overlayHeaderClassName}>
            {isDestructive && (
              <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-md bg-destructive/10 [&_svg]:size-4 [&_svg]:text-destructive">
                <Icon name="alert" />
              </span>
            )}
            <Dialog.Title id={titleId} className="min-w-0 flex-1 text-control font-semibold text-popover-foreground">
              {title}
            </Dialog.Title>
          </div>
          <div className={overlayBodyClassName}>
            <Dialog.Description render={<div />} id={descId} className={cn('text-control text-foreground', isDesktop && 'max-w-[60ch]')}>
              {description}
            </Dialog.Description>
          </div>
          <div className={overlayFooterClassName}>
            <div data-testid="confirm-action-row" className={cn('flex gap-2', !isDesktop && 'w-full flex-col')}>
              {isDesktop ? (
                <>
                  <Button ref={setCancelRef} variant="outline" disabled={loading} onClick={onCancel}>{cancelLabel}</Button>
                  <Button variant={isDestructive ? 'destructive' : 'primary'} loading={loading} disabled={confirmDisabled} onClick={onConfirm}>{confirmLabel}</Button>
                </>
              ) : (
                cancelFirstOnMobile ? (
                  <>
                    <Button ref={setCancelRef} variant="outline" disabled={loading} className="touch-target h-11 w-full text-control" onClick={onCancel}>{cancelLabel}</Button>
                    <Button variant={isDestructive ? 'destructive' : 'primary'} loading={loading} disabled={confirmDisabled} className="touch-target h-11 w-full text-control" onClick={onConfirm}>{confirmLabel}</Button>
                  </>
                ) : (
                  <>
                    <Button variant={isDestructive ? 'destructive' : 'primary'} loading={loading} disabled={confirmDisabled} className="touch-target h-11 w-full text-control" onClick={onConfirm}>{confirmLabel}</Button>
                    <Button ref={setCancelRef} variant="outline" disabled={loading} className="touch-target h-11 w-full text-control" onClick={onCancel}>{cancelLabel}</Button>
                  </>
                )
              )}
            </div>
          </div>
        </Dialog.Popup>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

ConfirmDialog.displayName = 'ConfirmDialog';
