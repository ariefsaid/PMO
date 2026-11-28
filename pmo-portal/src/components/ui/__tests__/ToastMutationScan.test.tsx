import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import React from 'react';
import { Drawer, ToastProvider } from '../index';

afterEach(() => vi.restoreAllMocks());

describe('toast placement does not scan the whole document for unrelated changes', () => {
  it('no overlay open: adding ordinary nodes triggers no [aria-modal] scan; opening a modal still moves the stack', async () => {
    const Host: React.FC<{ open: boolean }> = ({ open }) => (
      <ToastProvider>
        <Drawer open={open} title="Claim" onClose={() => undefined}><div /></Drawer>
      </ToastProvider>
    );
    const view = render(<Host open={false} />);
    const toast = document.querySelector<HTMLElement>('[data-toast-container]')!;
    const scan = vi.spyOn(document, 'querySelectorAll');
    await act(async () => {
      for (let i = 0; i < 20; i += 1) document.body.append(document.createElement('div'));
      await Promise.resolve();
    });
    expect(scan).not.toHaveBeenCalled();

    view.rerender(<Host open />);
    await waitFor(() => expect(toast).toHaveAttribute('data-overlay-drawer', 'true'));
    view.rerender(<Host open={false} />);
    await waitFor(() => expect(toast).toHaveAttribute('data-dialog-open', 'false'));
  });
});
