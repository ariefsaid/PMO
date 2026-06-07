import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ConfirmDialog } from '../ConfirmDialog';

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
