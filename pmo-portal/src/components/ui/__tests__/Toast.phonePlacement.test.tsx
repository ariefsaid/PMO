import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { ToastProvider, useToast } from '../index';

const Trigger = () => {
  const { toast } = useToast();
  return <button onClick={() => toast('Could not change status', 'Try again', 'error')}>Fail</button>;
};

const setPhone = (matches: boolean) => {
  window.matchMedia = ((query: string) => ({
    matches, media: query, onchange: null,
    addEventListener: () => undefined, removeEventListener: () => undefined,
    addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
};

describe('Toast phone placement', () => {
  const original = window.matchMedia;
  beforeEach(() => setPhone(true));
  afterEach(() => { window.matchMedia = original; });

  it('on a phone an error toast is placed top-center and its close button sits inside the toast, on its leading edge', async () => {
    render(<ToastProvider><Trigger /></ToastProvider>);
    await act(async () => { screen.getByText('Fail').click(); });
    const toaster = await waitFor(() => {
      const el = document.querySelector('[data-sonner-toaster]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    // The library's own position option: top, centred, never the bottom action area.
    expect(toaster).toHaveAttribute('data-y-position', 'top');
    expect(toaster).toHaveAttribute('data-x-position', 'center');
    const toastEl = document.querySelector<HTMLElement>('[data-sonner-toast]')!;
    const close = toastEl.querySelector<HTMLElement>('[data-close-button]')!;
    expect(toastEl.contains(close)).toBe(true);
    // Inside the toast's box: anchored left, no outward shift and clear of trailing page actions.
    expect(close.className).toMatch(/!left-2/);
    expect(close.className).toMatch(/!right-auto/);
    expect(close.className).toMatch(/!translate-x-0/);
    expect(close.className).not.toMatch(/-translate-[xy]-1\/3/);
  });

  it('on desktop the stack stays at the bottom right', async () => {
    setPhone(false);
    render(<ToastProvider><Trigger /></ToastProvider>);
    await act(async () => { screen.getByText('Fail').click(); });
    await waitFor(() => expect(document.querySelector('[data-sonner-toaster]')).toHaveAttribute('data-y-position', 'bottom'));
  });
});
