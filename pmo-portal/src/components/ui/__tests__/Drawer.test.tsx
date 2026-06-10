import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { Drawer } from '../Drawer';
import { ConfirmDialog } from '../ConfirmDialog';

// ---------------------------------------------------------------------------
// Drawer — the right-side quick-view sheet (Wave-5 Cluster 6).
// Reuses EntityFormModal's EXACT overlay machinery (portal + scrim + Esc/scrim
// close + focus-capture/restore + Tab focus-trap + role="dialog"/aria-modal +
// loading gate + inert-while-nested). Tests assert real behavior, not mocks.
// AC-W5-C6-DRAWER owns the drawer behavior contract at the Vitest/RTL layer.
// ---------------------------------------------------------------------------

const baseProps = {
  open: true,
  title: 'Cascade Port Authority',
  onClose: vi.fn(),
};

describe('Drawer: render gating + a11y (AC-W5-C6-DRAWER)', () => {
  it('renders nothing when !open', () => {
    render(
      <Drawer {...baseProps} open={false}>
        <p>body</p>
      </Drawer>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders role="dialog" + aria-modal + aria-labelledby wired to the title', () => {
    render(
      <Drawer {...baseProps}>
        <p>body</p>
      </Drawer>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const labelId = dialog.getAttribute('aria-labelledby');
    expect(labelId).toBeTruthy();
    expect(document.getElementById(labelId!)?.textContent).toContain('Cascade Port Authority');
  });

  it('wires aria-describedby to the subtitle when given', () => {
    render(
      <Drawer {...baseProps} subtitle="Client">
        <p>body</p>
      </Drawer>,
    );
    const dialog = screen.getByRole('dialog');
    const descId = dialog.getAttribute('aria-describedby');
    expect(descId).toBeTruthy();
    expect(document.getElementById(descId!)?.textContent).toContain('Client');
  });

  it('renders the title, subtitle, body slot, and a footer slot', () => {
    render(
      <Drawer {...baseProps} subtitle="Vendor" footer={<button>Edit</button>}>
        <p>Identity fields</p>
      </Drawer>,
    );
    expect(screen.getByText('Cascade Port Authority')).toBeInTheDocument();
    expect(screen.getByText('Vendor')).toBeInTheDocument();
    expect(screen.getByText('Identity fields')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('the close icon button has an accessible name', () => {
    render(
      <Drawer {...baseProps}>
        <p>body</p>
      </Drawer>,
    );
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
  });
});

describe('Drawer: close paths (AC-W5-C6-DRAWER)', () => {
  it('the close button fires onClose', async () => {
    const onClose = vi.fn();
    render(
      <Drawer {...baseProps} onClose={onClose}>
        <p>body</p>
      </Drawer>,
    );
    await userEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Esc fires onClose', () => {
    const onClose = vi.fn();
    render(
      <Drawer {...baseProps} onClose={onClose}>
        <p>body</p>
      </Drawer>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('scrim click fires onClose', async () => {
    const onClose = vi.fn();
    render(
      <Drawer {...baseProps} onClose={onClose}>
        <p>body</p>
      </Drawer>,
    );
    await userEvent.click(screen.getByTestId('drawer-scrim'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('Drawer: loading gate (AC-W5-C6-DRAWER)', () => {
  it('Esc while loading does NOT close', () => {
    const onClose = vi.fn();
    render(
      <Drawer {...baseProps} loading onClose={onClose}>
        <p>body</p>
      </Drawer>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('scrim click while loading does NOT close', async () => {
    const onClose = vi.fn();
    render(
      <Drawer {...baseProps} loading onClose={onClose}>
        <p>body</p>
      </Drawer>,
    );
    await userEvent.click(screen.getByTestId('drawer-scrim'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('close button is disabled while loading', () => {
    render(
      <Drawer {...baseProps} loading>
        <p>body</p>
      </Drawer>,
    );
    expect(screen.getByRole('button', { name: /close/i })).toBeDisabled();
  });
});

describe('Drawer: focus management (AC-W5-C6-DRAWER)', () => {
  it('moves focus into the drawer on open and restores to the trigger on close', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'open';
    document.body.appendChild(trigger);
    trigger.focus();

    const { rerender } = render(
      <Drawer {...baseProps}>
        <button>field</button>
      </Drawer>,
    );
    expect(trigger).not.toHaveFocus();
    rerender(
      <Drawer {...baseProps} open={false}>
        <button>field</button>
      </Drawer>,
    );
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it('C1: restores focus to the trigger when the Drawer is UNMOUNTED (conditional-render consumers)', () => {
    // This is the gap: both CompanyDrawer and DocumentDrawer mount/unmount the Drawer
    // conditionally ({company && <CompanyDrawer/>}) rather than re-rendering with open=false.
    // The [open] effect's else-if branch never fires on unmount, so focus falls to <body>.
    // Fix: the effect cleanup captures the trigger and restores focus on unmount.
    const trigger = document.createElement('button');
    trigger.textContent = 'open row';
    document.body.appendChild(trigger);
    trigger.focus();

    // Mount the Drawer (open=true always, simulating the consumer pattern).
    const { unmount } = render(
      <Drawer {...baseProps}>
        <button>field</button>
      </Drawer>,
    );
    // Focus has moved into the drawer (the first focusable).
    expect(trigger).not.toHaveFocus();

    // Unmount entirely (simulates the conditional-render consumer closing).
    unmount();

    // Focus MUST be restored to the trigger, not left on <body>.
    expect(trigger).toHaveFocus();
    trigger.remove();
  });
});

describe('Drawer: focus trap (AC-W5-C6-DRAWER)', () => {
  it('Tab from the last focusable wraps to the first', () => {
    render(
      <Drawer {...baseProps}>
        <button>a</button>
        <button>b</button>
      </Drawer>,
    );
    const dialog = screen.getByRole('dialog');
    const focusables = dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(first).toHaveFocus();
  });

  it('Shift+Tab from the first focusable wraps to the last', () => {
    render(
      <Drawer {...baseProps}>
        <button>a</button>
        <button>b</button>
      </Drawer>,
    );
    const dialog = screen.getByRole('dialog');
    const focusables = dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    first.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
  });
});

describe('Drawer: nested ConfirmDialog inert-the-panel (AC-W5-C6-DRAWER)', () => {
  it('when a nested confirm owns focus, the drawer goes inert + aria-hidden and its trap is suspended', async () => {
    function Harness() {
      const [confirm, setConfirm] = React.useState(false);
      return (
        <Drawer {...baseProps} nestedOpen={confirm}>
          <button onClick={() => setConfirm(true)}>Delete</button>
          <ConfirmDialog
            open={confirm}
            tone="destructive"
            title="Delete?"
            description="gone"
            confirmLabel="Delete"
            onConfirm={() => setConfirm(false)}
            onCancel={() => setConfirm(false)}
          />
        </Drawer>
      );
    }
    render(<Harness />);
    const drawer = screen.getByRole('dialog');
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const confirmDialog = await screen.findByRole('alertdialog');
    expect(confirmDialog).toBeInTheDocument();
    expect(drawer).toHaveAttribute('aria-hidden', 'true');
    expect(drawer).toHaveAttribute('inert');

    // The drawer's OWN trap must be suspended while the confirm is up: Tab on the
    // drawer dialog must be a no-op (not wrap focus back into the drawer body).
    const drawerFocusables = drawer.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const last = drawerFocusables[drawerFocusables.length - 1];
    last.focus();
    fireEvent.keyDown(drawer, { key: 'Tab' });
    expect(drawerFocusables[0]).not.toHaveFocus();
    expect(last).toHaveFocus();
  });
});

describe('Drawer: width preset (AC-W5-C6-DRAWER)', () => {
  it('width="lg" applies the wider preset', () => {
    render(
      <Drawer {...baseProps} width="lg">
        <p>body</p>
      </Drawer>,
    );
    expect(screen.getByRole('dialog').className).toContain('560px');
  });

  it('default (sm) applies the 420px preset', () => {
    render(
      <Drawer {...baseProps}>
        <p>body</p>
      </Drawer>,
    );
    expect(screen.getByRole('dialog').className).toContain('420px');
  });
});
