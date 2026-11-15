import { describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import React from 'react';
import { Drawer, ToastProvider } from '../index';

describe('#2105 toast placement observer stays cheap', () => {
  it('an unrelated re-render with a drawer open neither rescans the document nor re-measures the header', async () => {
    render(
      <ToastProvider>
        <Drawer open title="Claim" onClose={() => undefined}>
          <div data-testid="rows" />
        </Drawer>
      </ToastProvider>,
    );
    const toast = document.querySelector<HTMLElement>('[data-toast-container]');
    await waitFor(() => expect(toast).toHaveAttribute('data-overlay-drawer', 'true'));

    const header = document.querySelector<HTMLElement>('[data-drawer-header]')!;
    const measure = vi.spyOn(header, 'getBoundingClientRect');
    const scan = vi.spyOn(document, 'querySelectorAll');

    const rows = document.querySelector('[data-testid="rows"]')!;
    await act(async () => {
      for (let i = 0; i < 20; i += 1) rows.append(document.createElement('div'));
      await Promise.resolve();
    });

    expect(measure).not.toHaveBeenCalled();
    expect(scan).not.toHaveBeenCalled();
    scan.mockRestore();
  });
});
