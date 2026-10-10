import { describe, expect, it } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { ConfirmDialog, ToastProvider, useToast } from '../index';

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
    view.rerender(<ToastProvider><ToastTrigger /><ConfirmDialog open={false} title="Discard changes?" description="Unsaved changes remain." confirmLabel="Discard" onConfirm={() => {}} onCancel={() => {}} /></ToastProvider>);
    await waitFor(() => expect(toast).toHaveAttribute('data-dialog-open', 'false'));
    expect(screen.getByRole('alert')).toHaveTextContent('Keep this remedy visible');
  });
});
