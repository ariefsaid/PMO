import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { ConfirmDialog, Drawer, ToastProvider, useToast } from '../index';

const ToastTrigger = () => {
  const { toast } = useToast();
  return <button onClick={() => toast('Persistent warning', 'Keep this remedy visible', 'warning')}>Warn</button>;
};

describe('Toast and dialog geometry', () => {
  it('AC-UXS-026 moves a persistent warning above the open confirmation without dismissing it', async () => {
    const view = render(<ToastProvider><ToastTrigger /><ConfirmDialog open title="Discard changes?" description="Unsaved changes remain." confirmLabel="Discard" onConfirm={() => {}} onCancel={() => {}} /></ToastProvider>);
    await act(async () => { screen.getByRole('button', { name: 'Warn' }).click(); });
    const toast = document.querySelector<HTMLElement>('[data-toast-container]');
    await waitFor(() => expect(toast).toHaveAttribute('data-dialog-open', 'true'));
    expect(screen.getByRole('alert')).toHaveTextContent('Keep this remedy visible');
    // The library stack itself renders at the safe top edge while the dialog is open.
    await waitFor(() => expect(document.querySelector('[data-sonner-toaster]')).toHaveAttribute('data-y-position', 'top'));
    view.rerender(<ToastProvider><ToastTrigger /><ConfirmDialog open={false} title="Discard changes?" description="Unsaved changes remain." confirmLabel="Discard" onConfirm={() => {}} onCancel={() => {}} /></ToastProvider>);
    await waitFor(() => expect(toast).toHaveAttribute('data-dialog-open', 'false'));
    expect(screen.getByRole('alert')).toHaveTextContent('Keep this remedy visible');
    await waitFor(() => expect(document.querySelector('[data-sonner-toaster]')).toHaveAttribute('data-y-position', 'bottom'));
  });

  // Issue 1816: a side drawer is edge-anchored, so the dialog remedy above would land a
  // toast exactly on the drawer's header (title + action buttons). The placement seam must
  // mark the drawer and measure its live header band instead. Asserts the placement state,
  // not looks — the rendered geometry proof lives in the e2e drawer journey (AC-TM-018).
  it('issue 1816 marks an open drawer and measures its header band into the toast offset, clearing on close', async () => {
    const view = render(
      <ToastProvider>
        <ToastTrigger />
        <Drawer open title="Time-and-materials claim" onClose={() => undefined}>
          <p>Drawer body</p>
        </Drawer>
      </ToastProvider>,
    );
    const toast = document.querySelector<HTMLElement>('[data-toast-container]');
    expect(toast).not.toBeNull();
    await waitFor(() => expect(toast).toHaveAttribute('data-overlay-drawer', 'true'));
    const inset = toast!.style.getPropertyValue('--toast-top-inset');
    expect(inset).toMatch(/^\d+px$/);

    act(() => { screen.getByRole('button', { name: 'Warn' }).click(); });
    // The drawer stays marked while the dialog flag (still true — the drawer is aria-modal)
    // and the measured offset both hold.
    expect(toast).toHaveAttribute('data-dialog-open', 'true');
    expect(toast!.style.getPropertyValue('--toast-top-inset')).toBe(inset);

    view.rerender(
      <ToastProvider>
        <ToastTrigger />
        <Drawer open={false} title="Time-and-materials claim" onClose={() => undefined}>
          <p>Drawer body</p>
        </Drawer>
      </ToastProvider>,
    );
    await waitFor(() => expect(toast).not.toHaveAttribute('data-overlay-drawer'));
    expect(toast!.style.getPropertyValue('--toast-top-inset')).toBe('');
  });

  it('issue 1816 re-measures the drawer header on viewport resize', async () => {
    render(
      <ToastProvider>
        <ToastTrigger />
        <Drawer open title="Time-and-materials claim" onClose={() => undefined}>
          <p>Drawer body</p>
        </Drawer>
      </ToastProvider>,
    );
    const toast = document.querySelector<HTMLElement>('[data-toast-container]');
    await waitFor(() => expect(toast).toHaveAttribute('data-overlay-drawer', 'true'));
    const before = toast!.style.getPropertyValue('--toast-top-inset');
    // jsdom reports zero rects, so drive the seam directly: any window resize event must
    // re-run the measurement pass rather than leaving the open drawer's offset stale.
    const header = document.querySelector<HTMLElement>('[data-drawer-header]');
    expect(header).not.toBeNull();
    vi.spyOn(header!, 'getBoundingClientRect').mockReturnValue({ bottom: 96, top: 0, left: 0, right: 390, width: 390, height: 96, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    window.dispatchEvent(new Event('resize'));
    await waitFor(() => expect(toast!.style.getPropertyValue('--toast-top-inset')).toBe('108px'));
    expect(before).not.toBe('108px');
  });
});
