import { describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import React from 'react';
import { Drawer, ToastProvider } from '../index';

describe('toast placement follows the drawer header band', () => {
  it('re-measures when the header grows inside its own subtree, so a toast never covers it', async () => {
    render(
      <ToastProvider>
        <Drawer open title="Claim" onClose={() => undefined}>
          <div />
        </Drawer>
      </ToastProvider>,
    );
    const toast = document.querySelector<HTMLElement>('[data-toast-container]')!;
    await waitFor(() => expect(toast).toHaveAttribute('data-overlay-drawer', 'true'));
    const header = document.querySelector<HTMLElement>('[data-drawer-header]')!;
    expect(toast.style.getPropertyValue('--toast-top-inset')).toBe('12px');

    // A line arrives deep inside the header (e.g. a status note under the title): the header's box
    // grows while the drawer's own children are unchanged.
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue({ bottom: 120 } as DOMRect);
    const deepest = header.querySelector('h2, h1, [id]') ?? header;
    await act(async () => {
      deepest.append(document.createElement('p'));
      await Promise.resolve();
    });

    await waitFor(() => expect(toast.style.getPropertyValue('--toast-top-inset')).toBe('132px'));
  });
});
