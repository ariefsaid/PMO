import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ConfirmDialog } from '../ConfirmDialog';

// ---------------------------------------------------------------------------
// matchMedia helpers — let tests control the breakpoint seam.
// ---------------------------------------------------------------------------
function mockMatchMedia(matches: boolean) {
  const listeners: ((e: MediaQueryListEvent) => void)[] = [];
  const mql = {
    matches,
    media: '(min-width: 768px)',
    onchange: null,
    addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => listeners.push(cb),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(mql));
  return mql;
}

// ---------------------------------------------------------------------------
// AC-CONFIRM-001..009 — the reusable ConfirmDialog primitive.
// Verifies real rendered behavior: open/closed, both tones, focus trap,
// Esc/scrim, loading lockout, and the reduced-motion variant.
// ---------------------------------------------------------------------------

const baseProps = {
  open: true,
  title: 'Mark deal as lost',
  description: 'This moves the deal to a terminal stage. This cannot be undone.',
  confirmLabel: 'Mark lost',
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
};

beforeEach(() => {
  baseProps.onConfirm = vi.fn();
  baseProps.onCancel = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AC-CONFIRM-001: render gating', () => {
  it('AC-CONFIRM-001: renders title, description, confirm + default Cancel label when open', () => {
    render(<ConfirmDialog {...baseProps} />);
    expect(screen.getByText('Mark deal as lost')).toBeInTheDocument();
    expect(
      screen.getByText(/This moves the deal to a terminal stage/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark lost' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('AC-CONFIRM-001: renders a custom cancelLabel', () => {
    render(<ConfirmDialog {...baseProps} cancelLabel="Keep open" />);
    expect(screen.getByRole('button', { name: 'Keep open' })).toBeInTheDocument();
  });

  it('AC-CONFIRM-001: renders nothing when !open', () => {
    render(<ConfirmDialog {...baseProps} open={false} />);
    expect(screen.queryByText('Mark deal as lost')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

describe('AC-CONFIRM-002: confirm/cancel wiring', () => {
  it('AC-CONFIRM-002: onConfirm fires on confirm-button click', async () => {
    render(<ConfirmDialog {...baseProps} />);
    await userEvent.click(screen.getByRole('button', { name: 'Mark lost' }));
    expect(baseProps.onConfirm).toHaveBeenCalledTimes(1);
    expect(baseProps.onCancel).not.toHaveBeenCalled();
  });

  it('AC-CONFIRM-002: onCancel fires on cancel-button click', async () => {
    render(<ConfirmDialog {...baseProps} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(baseProps.onCancel).toHaveBeenCalledTimes(1);
    expect(baseProps.onConfirm).not.toHaveBeenCalled();
  });
});

describe('AC-CONFIRM-003: tone drives role, fill and icon', () => {
  it('AC-CONFIRM-003: destructive tone => role="alertdialog" + bg-destructive confirm + alert icon', () => {
    render(<ConfirmDialog {...baseProps} tone="destructive" />);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Mark lost' });
    expect(confirm.className).toContain('bg-destructive');
    // color-not-only: a leading alert icon, not red alone
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.querySelector('svg')).toBeTruthy();
  });

  it('AC-CONFIRM-003: default tone => role="dialog" + bg-primary confirm', () => {
    render(<ConfirmDialog {...baseProps} tone="default" confirmLabel="Advance" />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Advance' });
    expect(confirm.className).toContain('bg-primary');
  });
});

describe('AC-CONFIRM-004: Escape + scrim close (blocked while loading)', () => {
  it('AC-CONFIRM-004: Escape key calls onCancel', () => {
    render(<ConfirmDialog {...baseProps} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(baseProps.onCancel).toHaveBeenCalledTimes(1);
  });

  it('AC-CONFIRM-004: scrim click (modal) calls onCancel', async () => {
    render(<ConfirmDialog {...baseProps} tone="destructive" />);
    await userEvent.click(screen.getByTestId('confirm-scrim'));
    expect(baseProps.onCancel).toHaveBeenCalledTimes(1);
  });

  it('AC-CONFIRM-004: while loading, Escape does NOT close', () => {
    render(<ConfirmDialog {...baseProps} loading />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(baseProps.onCancel).not.toHaveBeenCalled();
  });

  it('AC-CONFIRM-004: while loading, scrim click does NOT close', async () => {
    render(<ConfirmDialog {...baseProps} tone="destructive" loading />);
    await userEvent.click(screen.getByTestId('confirm-scrim'));
    expect(baseProps.onCancel).not.toHaveBeenCalled();
  });
});

describe('AC-CONFIRM-005: a11y wiring + focus management', () => {
  it('AC-CONFIRM-005: aria-modal + labelledby/describedby wired to title/description', () => {
    render(<ConfirmDialog {...baseProps} tone="destructive" />);
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const labelId = dialog.getAttribute('aria-labelledby');
    const descId = dialog.getAttribute('aria-describedby');
    expect(labelId).toBeTruthy();
    expect(descId).toBeTruthy();
    expect(document.getElementById(labelId!)?.textContent).toContain('Mark deal as lost');
    expect(document.getElementById(descId!)?.textContent).toContain('terminal stage');
  });

  it('AC-CONFIRM-005: on open, focus lands on Cancel (safe default, not the destructive confirm)', async () => {
    render(<ConfirmDialog {...baseProps} tone="destructive" />);
    // focus moves on the next frame; assert it settled on Cancel
    await screen.findByRole('alertdialog');
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('AC-CONFIRM-005: restores focus to the trigger on close', async () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'open';
    document.body.appendChild(trigger);
    trigger.focus();
    expect(trigger).toHaveFocus();

    const { rerender } = render(<ConfirmDialog {...baseProps} tone="destructive" />);
    // focus moved into the dialog
    expect(trigger).not.toHaveFocus();
    rerender(<ConfirmDialog {...baseProps} tone="destructive" open={false} />);
    expect(trigger).toHaveFocus();
    trigger.remove();
  });
});

describe('AC-CONFIRM-005: focus trap (onTrapKeyDown)', () => {
  it('AC-CONFIRM-005: Tab from the Confirm button wraps focus back to Cancel', () => {
    render(<ConfirmDialog {...baseProps} />);
    const dialog = screen.getByRole('dialog');
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'Mark lost' });
    // Confirm is the LAST focusable; Tab from it wraps to the first (Cancel).
    confirm.focus();
    expect(confirm).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(cancel).toHaveFocus();
  });

  it('AC-CONFIRM-005: Shift+Tab from the Cancel button wraps focus to Confirm', () => {
    render(<ConfirmDialog {...baseProps} />);
    const dialog = screen.getByRole('dialog');
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'Mark lost' });
    // Cancel is the FIRST focusable; Shift+Tab from it wraps to the last (Confirm).
    cancel.focus();
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(confirm).toHaveFocus();
  });
});

describe('AC-CONFIRM-006: loading state', () => {
  it('AC-CONFIRM-006: loading => confirm spinner + both buttons disabled + aria-busy', () => {
    render(<ConfirmDialog {...baseProps} loading />);
    expect(screen.getByTestId('button-spinner')).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Mark lost' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(confirm).toBeDisabled();
    expect(cancel).toBeDisabled();
    expect(confirm).toHaveAttribute('aria-busy', 'true');
  });

  it('AC-CONFIRM-006: clicking confirm while loading does not re-fire onConfirm (double-click guard)', async () => {
    render(<ConfirmDialog {...baseProps} loading />);
    await userEvent.click(screen.getByRole('button', { name: 'Mark lost' }));
    expect(baseProps.onConfirm).not.toHaveBeenCalled();
  });
});

describe('AC-CONFIRM-009: reduced-motion variant', () => {
  it('AC-CONFIRM-009: dialog carries a motion-reduce: variant so animation degrades to a crossfade', () => {
    render(<ConfirmDialog {...baseProps} tone="destructive" />);
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.className).toContain('motion-reduce:');
  });
});

// ---------------------------------------------------------------------------
// AC-CONFIRM-010: mobile bottom-sheet vs desktop centered-dialog layout
// B-IMP-1 fix: below the 768px seam the confirm renders as a bottom-anchored
// sheet (action row in the thumb zone); desktop stays the centered overlay.
// Single-render: one branch in the DOM (useIsDesktop seam — no dual a11y tree).
// ---------------------------------------------------------------------------

describe('AC-CONFIRM-010: desktop — centered dialog layout (≥768px)', () => {
  it('AC-CONFIRM-010: desktop wrapper uses flex items-center justify-center (centered)', () => {
    // Simulate desktop viewport
    mockMatchMedia(true);
    render(<ConfirmDialog {...baseProps} />);
    // The outer portal wrapper must be the centering flex container
    const dialog = screen.getByRole('dialog');
    const wrapper = dialog.parentElement!;
    expect(wrapper.className).toContain('items-center');
    expect(wrapper.className).toContain('justify-center');
    // It must NOT have the bottom-sheet anchoring class
    expect(wrapper.className).not.toContain('items-end');
  });

  it('AC-CONFIRM-010: desktop dialog carries the centered scale-in animation class', () => {
    mockMatchMedia(true);
    render(<ConfirmDialog {...baseProps} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('confirm-anim');
  });

  it('AC-CONFIRM-010: desktop a11y — role, aria-modal, labelledby, describedby intact', () => {
    mockMatchMedia(true);
    render(<ConfirmDialog {...baseProps} tone="destructive" />);
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
  });
});

describe('AC-CONFIRM-010: mobile — bottom-sheet layout (<768px)', () => {
  it('AC-CONFIRM-010: mobile wrapper uses items-end (bottom-anchored, not centered)', () => {
    // Simulate mobile viewport
    mockMatchMedia(false);
    render(<ConfirmDialog {...baseProps} />);
    const dialog = screen.getByRole('dialog');
    const wrapper = dialog.parentElement!;
    // Bottom-anchored: items-end, NOT items-center
    expect(wrapper.className).toContain('items-end');
    expect(wrapper.className).not.toContain('items-center');
  });

  it('AC-CONFIRM-010: mobile sheet spans the full bottom width (w-full, no max-width clamp)', () => {
    mockMatchMedia(false);
    render(<ConfirmDialog {...baseProps} />);
    const dialog = screen.getByRole('dialog');
    // Full-width sheet on mobile
    expect(dialog.className).toContain('w-full');
    // Should NOT have the desktop max-width cap that constrains the centered dialog
    expect(dialog.className).not.toContain('max-w-[420px]');
  });

  it('AC-CONFIRM-010: mobile sheet has rounded-t corners only (bottom-sheet rounding)', () => {
    mockMatchMedia(false);
    render(<ConfirmDialog {...baseProps} />);
    const dialog = screen.getByRole('dialog');
    // Bottom-sheet: top corners rounded, bottom square
    expect(dialog.className).toContain('rounded-t-lg');
    // Must NOT have the symmetric rounded-lg used by the centered desktop dialog
    expect(dialog.className).not.toContain(' rounded-lg ');
  });

  it('AC-CONFIRM-010: mobile action row stacks buttons full-width for thumb zone reach', () => {
    mockMatchMedia(false);
    render(<ConfirmDialog {...baseProps} />);
    // Buttons should be accessible in thumb zone — verify action row is present
    // and buttons are full-width on mobile (flex-col or w-full layout)
    const actionRow = screen.getByTestId('confirm-action-row');
    expect(actionRow.className).toContain('flex-col');
  });

  it('AC-CONFIRM-010: mobile slide-up animation class applied to sheet', () => {
    mockMatchMedia(false);
    render(<ConfirmDialog {...baseProps} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('confirm-sheet-anim');
  });

  it('AC-CONFIRM-010: mobile a11y — role, aria-modal, labelledby, describedby intact on sheet', () => {
    mockMatchMedia(false);
    render(<ConfirmDialog {...baseProps} tone="destructive" />);
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const labelId = dialog.getAttribute('aria-labelledby')!;
    const descId = dialog.getAttribute('aria-describedby')!;
    expect(labelId).toBeTruthy();
    expect(descId).toBeTruthy();
    expect(document.getElementById(labelId)?.textContent).toContain('Mark deal as lost');
    expect(document.getElementById(descId)?.textContent).toContain('terminal stage');
  });

  it('AC-CONFIRM-010: mobile ESC closes the sheet', () => {
    mockMatchMedia(false);
    render(<ConfirmDialog {...baseProps} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(baseProps.onCancel).toHaveBeenCalledTimes(1);
  });

  it('AC-CONFIRM-010: mobile scrim click closes the sheet', async () => {
    mockMatchMedia(false);
    render(<ConfirmDialog {...baseProps} />);
    await userEvent.click(screen.getByTestId('confirm-scrim'));
    expect(baseProps.onCancel).toHaveBeenCalledTimes(1);
  });

  it('AC-CONFIRM-010: mobile focus lands on Cancel on open', async () => {
    mockMatchMedia(false);
    render(<ConfirmDialog {...baseProps} tone="destructive" />);
    await screen.findByRole('alertdialog');
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });
});
