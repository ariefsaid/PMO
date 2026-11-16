/** #2353 — with the navigation drawer open, a toast never covers its pinned Approvals row. */
import { describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { ToastProvider } from '../index';

describe('toast placement under the navigation drawer', () => {
  it('sits below the pinned Approvals row while the navigation drawer is open', async () => {
    const view = render(
      <ToastProvider>
        <div role="dialog" aria-modal="true" aria-label="Navigation menu">
          <div data-rail-pinned-approvals>Approvals</div>
        </div>
      </ToastProvider>,
    );
    const row = view.container.querySelector<HTMLElement>('[data-rail-pinned-approvals]')!;
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ bottom: 96 } as DOMRect);
    // trigger a re-measure (the real drawer mounts after the provider)
    window.dispatchEvent(new Event('resize'));
    const toast = document.querySelector<HTMLElement>('[data-toast-container]')!;
    await waitFor(() => expect(toast.style.getPropertyValue('--toast-top-inset')).toBe('108px'));
    expect(toast).toHaveAttribute('data-overlay-drawer', 'true');
  });
});
