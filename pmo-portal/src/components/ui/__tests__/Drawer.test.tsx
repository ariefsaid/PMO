import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { Drawer } from '../Drawer';
import { ConfirmDialog } from '../ConfirmDialog';

// ---------------------------------------------------------------------------
// Drawer — the right-side quick-view sheet (Wave-5 Cluster 6).
// Built on Base UI's Drawer (#2043): portal + scrim + Esc/outside-press close +
// focus capture/restore + focus trap + swipe, plus our loading gate, nested-dialog
// veto and stacking rule. Tests assert real behavior, not mocks.
// AC-W5-C6-DRAWER owns the drawer behavior contract at the Vitest/RTL layer.
// ---------------------------------------------------------------------------

const baseProps = {
  open: true,
  title: 'Cascade Port Authority',
  onClose: vi.fn(),
};

describe('Drawer: render gating + a11y (AC-W5-C6-DRAWER)', () => {
  it('AC-1416: record drawers use the full viewport width on phones and keep each desktop width preset', () => {
    const { rerender } = render(
      <Drawer {...baseProps}>
        <p>body</p>
      </Drawer>,
    );
    expect(screen.getByRole('dialog').className).toContain('max-md:w-full');
    expect(screen.getByRole('dialog').className).toContain('md:w-[min(420px,92vw)]');

    rerender(
      <Drawer {...baseProps} width="lg">
        <p>body</p>
      </Drawer>,
    );
    expect(screen.getByRole('dialog').className).toContain('max-md:w-full');
    expect(screen.getByRole('dialog').className).toContain('md:w-[min(560px,92vw)]');
  });

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

describe('Drawer: RecordHeader anatomy in the header (CW-3a)', () => {
  it('renders the shared RecordHeader (icon + name + status + top-right actions) when record props are given', () => {
    render(
      <Drawer
        {...baseProps}
        icon="C"
        status={<span>Vendor</span>}
        headerActions={<button type="button">Edit</button>}
      >
        <p>body</p>
      </Drawer>,
    );
    // The drawer header hosts the shared RecordHeader, not the plain title/subtitle row.
    expect(screen.getByTestId('record-header')).toBeInTheDocument();
    // status surfaces in the header
    expect(screen.getByText('Vendor')).toBeInTheDocument();
    // the action zone (Edit) is surfaced IN THE HEADER, not the footer
    const actionZone = screen.getByTestId('record-header-actions');
    expect(actionZone).toContainElement(screen.getByRole('button', { name: 'Edit' }));
  });

  it('still wires the dialog accessible name to the record name', () => {
    render(
      <Drawer {...baseProps} icon="C" status={<span>Client</span>}>
        <p>body</p>
      </Drawer>,
    );
    const dialog = screen.getByRole('dialog');
    const labelId = dialog.getAttribute('aria-labelledby');
    expect(document.getElementById(labelId!)?.textContent).toContain('Cascade Port Authority');
  });

  it('CMP-010: wires aria-describedby to subtitle anchor in record-header mode', () => {
    render(
      <Drawer {...baseProps} icon="C" subtitle="Client Subtitle">
        <p>body</p>
      </Drawer>,
    );
    const dialog = screen.getByRole('dialog');
    const descId = dialog.getAttribute('aria-describedby');
    expect(descId).toBeTruthy();
    expect(document.getElementById(descId!)?.textContent).toContain('Client Subtitle');
    expect(within(dialog).getAllByText('Client Subtitle')).toHaveLength(1);
  });

  it('CMP-009: the page behind is unreachable while open and reachable again after close', async () => {
    function Harness({ open }: { open: boolean }) {
      return (
        <>
          <button>behind</button>
          <Drawer {...baseProps} open={open}>
            <p>body</p>
          </Drawer>
        </>
      );
    }
    const { rerender } = render(<Harness open />);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'behind' })).not.toBeInTheDocument());
    rerender(<Harness open={false} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'behind' })).toBeInTheDocument());
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
  it('moves focus into the drawer on open and restores to the trigger on close', async () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'open';
    document.body.appendChild(trigger);
    trigger.focus();

    const { rerender } = render(
      <Drawer {...baseProps}>
        <button>field</button>
      </Drawer>,
    );
    await waitFor(() => expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement));
    rerender(
      <Drawer {...baseProps} open={false}>
        <button>field</button>
      </Drawer>,
    );
    await waitFor(() => expect(trigger).toHaveFocus());
    trigger.remove();
  });

  it('C1: restores focus to the trigger when the Drawer is UNMOUNTED (conditional-render consumers)', async () => {
    // Consumers mount/unmount the Drawer conditionally ({doc && <DocumentDrawer/>}) rather than
    // re-rendering with open=false; focus must still return to the row that opened it.
    const trigger = document.createElement('button');
    trigger.textContent = 'open row';
    document.body.appendChild(trigger);
    trigger.focus();

    const { unmount } = render(
      <Drawer {...baseProps}>
        <button>field</button>
      </Drawer>,
    );
    await waitFor(() => expect(trigger).not.toHaveFocus());
    unmount();
    await waitFor(() => expect(trigger).toHaveFocus());
    trigger.remove();
  });
});

describe('Drawer: focus trap (AC-W5-C6-DRAWER)', () => {
  it('Tab and Shift+Tab cycle inside the drawer and never reach the page behind', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button>behind</button>
        <Drawer {...baseProps}>
          <button>a</button>
          <button>b</button>
        </Drawer>
      </>,
    );
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));
    for (let i = 0; i < 6; i += 1) {
      await user.tab();
      // The library parks focus on a guard for a tick, then moves it back inside.
      await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));
    }
    for (let i = 0; i < 6; i += 1) {
      await user.tab({ shift: true });
      await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));
    }
  });
});

describe('Drawer: nested ConfirmDialog inert-the-panel (AC-W5-C6-DRAWER)', () => {
  it('when a nested confirm owns focus, the drawer goes inert + aria-hidden and focus stays in the confirm', async () => {
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

    // The confirm owns focus: its Cancel button is focused, not anything in the drawer behind.
    await waitFor(() => expect(confirmDialog).toContainElement(document.activeElement as HTMLElement));
  });

  it('Esc with a nested confirm open does not close the drawer', async () => {
    const onClose = vi.fn();
    render(
      <Drawer {...baseProps} onClose={onClose} nestedOpen>
        <p>body</p>
      </Drawer>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('Drawer: responsive width (AC-W5-C6-DRAWER)', () => {
  it('fills the viewport below the md breakpoint for every record drawer', () => {
    render(
      <Drawer {...baseProps}>
        <p>body</p>
      </Drawer>,
    );
    expect(screen.getByRole('dialog').className).toContain('w-full');
    expect(screen.getByRole('dialog').className).toContain('md:w-[min(420px,92vw)]');
  });

  it('width="lg" applies the wider preset', () => {
    render(
      <Drawer {...baseProps} width="lg">
        <p>body</p>
      </Drawer>,
    );
    expect(screen.getByRole('dialog').className).toContain('md:w-[min(560px,92vw)]');
  });

  it('default (sm) applies the 420px preset', () => {
    render(
      <Drawer {...baseProps}>
        <p>body</p>
      </Drawer>,
    );
    expect(screen.getByRole('dialog').className).toContain('md:w-[min(420px,92vw)]');
  });
});

describe('Drawer: stacking (#2043)', () => {
  it('Esc and an outside click close only the topmost of two stacked drawers', async () => {
    const lower = vi.fn();
    const upper = vi.fn();
    render(
      <>
        <Drawer open title="Document" onClose={lower}>
          <p>lower body</p>
        </Drawer>
        <Drawer open title="Preview" onClose={upper}>
          <p>upper body</p>
        </Drawer>
      </>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(upper).toHaveBeenCalledTimes(1);
    expect(lower).not.toHaveBeenCalled();
  });

  it('swipes right to dismiss (side sheet), not down', () => {
    render(
      <Drawer {...baseProps}>
        <p>body</p>
      </Drawer>,
    );
    expect(screen.getByRole('dialog')).toHaveAttribute('data-drawer-panel');
  });
});
