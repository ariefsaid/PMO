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
  overlayDesktopContainerClassName,
  overlayMobileContainerClassName,
} from './OverlaySurface';

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
  /** Gate the confirm button — for a dialog that hosts a required input (e.g. an attestation reason).
   *  Cancel/Esc/scrim are NEVER blocked by this: the escape hatch stays open. */
  confirmDisabled?: boolean;
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
    if (element && open) element.focus();
  }, [open]);
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

  const content = (
    <>
      {isDestructive && (
        <span aria-hidden className="mt-px flex size-7 shrink-0 items-center justify-center rounded-md bg-destructive/10 [&_svg]:size-4 [&_svg]:text-destructive">
          <Icon name="alert" />
        </span>
      )}
      <div className="flex flex-col gap-1.5">
        <Dialog.Title id={titleId} className="text-[18px] font-semibold leading-[1.3] text-popover-foreground">
          {title}
        </Dialog.Title>
        <Dialog.Description render={<div />} id={descId} className={cn('text-[14px] leading-[1.45] text-foreground', isDesktop && 'max-w-[60ch]')}>
          {description}
        </Dialog.Description>
      </div>
    </>
  );

  return (
    <Dialog.Root open={open} modal={false} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <div className={cn('fixed inset-0 z-[800] flex', isDesktop ? 'items-center justify-center p-4' : 'items-end')}>
        <Dialog.Backdrop
          data-testid="confirm-scrim"
          className={cn('z-[800]', overlayBackdropClassName)}
        />
        <Dialog.Popup
          initialFocus={() => cancelRef.current}
          finalFocus={false}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              return;
            }
            if (event.key !== 'Tab') return;
            const focusable = event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            );
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }}
          role={isDestructive ? 'alertdialog' : 'dialog'}
          aria-labelledby={titleId}
          aria-describedby={descId}
          aria-modal="true"
          className={cn(
            isDesktop ? overlayDesktopContainerClassName : overlayMobileContainerClassName,
            'relative',
          )}
        >
          {!isDesktop && <div aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" />}
          <div className="flex items-start gap-3">{content}</div>
          <div data-testid="confirm-action-row" className={cn('mt-4 flex justify-end gap-2', !isDesktop && 'mt-5 flex-col')}>
            {isDesktop ? (
              <>
                <Button ref={setCancelRef} variant="outline" disabled={loading} onClick={onCancel}>{cancelLabel}</Button>
                <Button variant={isDestructive ? 'destructive' : 'primary'} loading={loading} disabled={confirmDisabled} onClick={onConfirm}>{confirmLabel}</Button>
              </>
            ) : (
              <>
                <Button variant={isDestructive ? 'destructive' : 'primary'} loading={loading} disabled={confirmDisabled} className="touch-target h-11 w-full text-[15px]" onClick={onConfirm}>{confirmLabel}</Button>
                <Button ref={setCancelRef} variant="outline" disabled={loading} className="touch-target h-11 w-full text-[15px]" onClick={onCancel}>{cancelLabel}</Button>
              </>
            )}
          </div>
        </Dialog.Popup>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

ConfirmDialog.displayName = 'ConfirmDialog';
