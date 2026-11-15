import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { UnsavedChangesDialog } from '../UnsavedChangesDialog';

function mockViewport(desktop: boolean) {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
    matches: desktop, media: '(min-width: 768px)', onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
}

const names = () => Array.from(screen.getByTestId('confirm-action-row').querySelectorAll('button')).map((b) => b.textContent);

afterEach(() => vi.unstubAllGlobals());

describe('#2080 unsaved-work dialog button order', () => {
  it('phone: Keep editing is the last (bottom, thumb-side) button and Discard sits above it', () => {
    mockViewport(false);
    render(<UnsavedChangesDialog open onDiscard={vi.fn()} onKeepEditing={vi.fn()} />);
    expect(names()).toEqual(['Discard', 'Keep editing']);
  });

  it('phone: Keep editing is the primary button; Discard is outlined with red text', () => {
    mockViewport(false);
    render(<UnsavedChangesDialog open onDiscard={vi.fn()} onKeepEditing={vi.fn()} />);
    const keep = screen.getByRole('button', { name: 'Keep editing' });
    const discard = screen.getByRole('button', { name: 'Discard' });
    expect(keep.className).toMatch(/bg-primary/);
    expect(discard.className).not.toMatch(/bg-destructive-solid/);
    expect(discard.className).toMatch(/border/);
    expect(discard.className).toContain('text-destructive-text');
  });

  it('desktop: order stays Keep editing, then Discard on the right', () => {
    mockViewport(true);
    render(<UnsavedChangesDialog open onDiscard={vi.fn()} onKeepEditing={vi.fn()} />);
    expect(names()).toEqual(['Keep editing', 'Discard']);
  });
});
