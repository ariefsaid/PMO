/**
 * AC-IXD-MOBILE-W4-C3 — Shell hardening tests (PR-2)
 *
 * Covers:
 *   C3-2  Drawer a11y — role=dialog, aria-modal, accessible name
 *   C3-3  Drawer focus-trap — Tab cycles within the drawer
 *   C3-4  Drawer Esc closes
 *   C3-5  Drawer scrim-click closes
 *   C3-6  Drawer focus: moves in on open, restores to hamburger on close
 *   C3-7  Drawer inert — the persistent rail+main are non-focusable while drawer open
 *   C3-8  Drawer has a visible close (×) button
 *   C3-9  Body scroll-lock while drawer open
 *   C3-10 Breadcrumb with no parent remains a single current location
 *   Phone target sizes and safe-area clearance are verified in browser proof.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { AppShell } from '../AppShell';
import { Breadcrumb } from '../Breadcrumb';

const wrap = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

// ---------------------------------------------------------------------------
// C3-2/C3-5: Drawer a11y — role=dialog, aria-modal, accessible name, scrim
// ---------------------------------------------------------------------------
describe('AC-IXD-MOBILE-W4-C3 C3-2/C3-5: drawer a11y and scrim-close', () => {
  it('renders a role=dialog with aria-modal=true when open', () => {
    wrap(
      <AppShell rail={<div>nav</div>} header={null} railOpen onCloseRail={vi.fn()}>
        <div>x</div>
      </AppShell>
    );
    const drawer = screen.getByRole('dialog');
    expect(drawer).toHaveAttribute('aria-modal', 'true');
  });

  it('the dialog has an accessible name', () => {
    wrap(
      <AppShell rail={<div>nav</div>} header={null} railOpen onCloseRail={vi.fn()}>
        <div>x</div>
      </AppShell>
    );
    const drawer = screen.getByRole('dialog');
    // aria-label or aria-labelledby must be set
    const hasLabel =
      drawer.hasAttribute('aria-label') || drawer.hasAttribute('aria-labelledby');
    expect(hasLabel).toBe(true);
  });

  it('C3-5: clicking the scrim calls onCloseRail', async () => {
    const onCloseRail = vi.fn();
    wrap(
      <AppShell rail={<div>nav</div>} header={null} railOpen onCloseRail={onCloseRail}>
        <div>x</div>
      </AppShell>
    );
    const scrim = screen.getByTestId('drawer-scrim');
    await userEvent.click(scrim);
    expect(onCloseRail).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// C3-8: Visible close button inside drawer
// ---------------------------------------------------------------------------
describe('AC-IXD-MOBILE-W4-C3 C3-8: drawer has a visible close button', () => {
  it('renders a close (×) button inside the drawer when open', () => {
    wrap(
      <AppShell rail={<div>nav</div>} header={null} railOpen onCloseRail={vi.fn()}>
        <div>x</div>
      </AppShell>
    );
    // Must be a button with an accessible label for close
    const closeBtn = screen.getByRole('button', { name: /close navigation/i });
    expect(closeBtn).toBeInTheDocument();
  });

  it('clicking the close button calls onCloseRail', async () => {
    const onCloseRail = vi.fn();
    wrap(
      <AppShell rail={<div>nav</div>} header={null} railOpen onCloseRail={onCloseRail}>
        <div>x</div>
      </AppShell>
    );
    await userEvent.click(screen.getByRole('button', { name: /close navigation/i }));
    expect(onCloseRail).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// C3-3: Focus trap — Tab cycles within the drawer
// ---------------------------------------------------------------------------
describe('AC-IXD-MOBILE-W4-C3 C3-3: focus trap cycles Tab within the drawer', () => {
  it('Tab from the last focusable inside the drawer wraps to the first', () => {
    const onCloseRail = vi.fn();
    wrap(
      <AppShell
        rail={
          <div>
            <a href="#a">Link A</a>
            <a href="#b">Link B</a>
          </div>
        }
        header={null}
        railOpen
        onCloseRail={onCloseRail}
      >
        <div>outside</div>
      </AppShell>
    );
    const drawer = screen.getByRole('dialog');
    // The outer wrapper has the onKeyDown trap — find it (parent of the drawer panel)
    const trapWrapper = drawer.parentElement!;
    // Collect all focusables inside the drawer panel
    const focusables = Array.from(
      drawer.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );
    expect(focusables.length).toBeGreaterThanOrEqual(2);
    // Focus the last focusable, then fire a raw keydown (not userEvent.keyboard
    // which also moves focus natively — ConfirmDialog tests use the same pattern).
    focusables[focusables.length - 1].focus();
    fireEvent.keyDown(trapWrapper, { key: 'Tab', shiftKey: false });
    expect(document.activeElement).toBe(focusables[0]);
  });

  it('Shift+Tab from the first focusable wraps to the last', () => {
    wrap(
      <AppShell
        rail={
          <div>
            <a href="#a">Link A</a>
            <a href="#b">Link B</a>
          </div>
        }
        header={null}
        railOpen
        onCloseRail={vi.fn()}
      >
        <div>outside</div>
      </AppShell>
    );
    const drawer = screen.getByRole('dialog');
    const trapWrapper = drawer.parentElement!;
    const focusables = Array.from(
      drawer.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );
    expect(focusables.length).toBeGreaterThanOrEqual(2);
    // Focus the close button (first focusable), Shift+Tab → wraps to last
    focusables[0].focus();
    fireEvent.keyDown(trapWrapper, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(focusables[focusables.length - 1]);
  });
});

// ---------------------------------------------------------------------------
// C3-4: Esc closes the drawer
// ---------------------------------------------------------------------------
describe('AC-IXD-MOBILE-W4-C3 C3-4: Esc key closes drawer', () => {
  it('pressing Esc calls onCloseRail', async () => {
    const onCloseRail = vi.fn();
    wrap(
      <AppShell rail={<div>nav</div>} header={null} railOpen onCloseRail={onCloseRail}>
        <div>x</div>
      </AppShell>
    );
    await userEvent.keyboard('{Escape}');
    expect(onCloseRail).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// C3-6: Focus moves into the drawer on open; restores to hamburger on close
// ---------------------------------------------------------------------------
describe('AC-IXD-MOBILE-W4-C3 C3-6: focus management', () => {
  it('focus moves into the drawer on open', async () => {
    await act(async () => {
      wrap(
        <AppShell rail={<div><a href="#a">Nav link</a></div>} header={null} railOpen onCloseRail={vi.fn()}>
          <div>x</div>
        </AppShell>
      );
    });
    const drawer = screen.getByRole('dialog');
    // activeElement should be inside the drawer after the setTimeout flushes
    await waitFor(() => {
      expect(drawer.contains(document.activeElement)).toBe(true);
    });
  });

  it('returns keyboard focus to the navigation trigger after Escape closes the drawer', async () => {
    const Harness = () => {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button type="button" data-drawer-toggle onClick={() => setOpen(true)}>
            Open navigation menu
          </button>
          <AppShell
            rail={<div><a href="#a">Nav link</a></div>}
            header={null}
            railOpen={open}
            onCloseRail={() => setOpen(false)}
          >
            <div>x</div>
          </AppShell>
        </>
      );
    };
    wrap(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open navigation menu' });
    await userEvent.setup().click(trigger);
    await waitFor(() => expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true));
    await userEvent.setup().keyboard('{Escape}');
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});

// ---------------------------------------------------------------------------
// C3-7: inert on background when drawer is open
// ---------------------------------------------------------------------------
describe('AC-IXD-MOBILE-W4-C3 C3-7: background content is inert while drawer is open', () => {
  it('the persistent rail wrapper is inert while the drawer is open', () => {
    const { container } = wrap(
      <AppShell rail={<a href="#nav">nav</a>} header={null} railOpen onCloseRail={vi.fn()}>
        <div>x</div>
      </AppShell>
    );
    const railLink = container.querySelector('a[href="#nav"]');
    expect(railLink?.closest('[inert]')).not.toBeNull();
  });

  it('the main content area is inert while the drawer is open', () => {
    wrap(
      <AppShell rail={<div>nav</div>} header={null} railOpen onCloseRail={vi.fn()}>
        <div>x</div>
      </AppShell>
    );
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('inert');
  });

  it('background is NOT inert when drawer is closed', () => {
    const { container } = wrap(
      <AppShell rail={<a href="#nav">nav</a>} header={null} railOpen={false} onCloseRail={vi.fn()}>
        <div>x</div>
      </AppShell>
    );
    const railLink = container.querySelector('a[href="#nav"]');
    expect(railLink?.closest('[inert]')).toBeNull();
    const main = screen.getByRole('main');
    expect(main).not.toHaveAttribute('inert');
  });
});

// ---------------------------------------------------------------------------
// C3-9: Body scroll lock while drawer open
// ---------------------------------------------------------------------------
describe('AC-IXD-MOBILE-W4-C3 C3-9: body scroll-lock while drawer open', () => {
  beforeEach(() => {
    document.body.style.overflow = '';
  });
  afterEach(() => {
    document.body.style.overflow = '';
  });

  it('adds overflow-hidden to body when the drawer opens', () => {
    wrap(
      <AppShell rail={<div>nav</div>} header={null} railOpen onCloseRail={vi.fn()}>
        <div>x</div>
      </AppShell>
    );
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('removes overflow-hidden from body when the drawer closes', () => {
    const { rerender } = wrap(
      <AppShell rail={<div>nav</div>} header={null} railOpen onCloseRail={vi.fn()}>
        <div>x</div>
      </AppShell>
    );
    expect(document.body.style.overflow).toBe('hidden');
    rerender(
      <MemoryRouter>
        <AppShell rail={<div>nav</div>} header={null} railOpen={false} onCloseRail={vi.fn()}>
          <div>x</div>
        </AppShell>
      </MemoryRouter>
    );
    expect(document.body.style.overflow).toBe('');
  });
});

// ---------------------------------------------------------------------------
// C3-10: Single-part breadcrumb semantics
// ---------------------------------------------------------------------------
describe('AC-IXD-MOBILE-W4-C3 C3-10: single-part breadcrumb semantics', () => {
  it('with only one part (no parent), nothing is hidden', () => {
    const { container } = render(
      <Breadcrumb parts={[{ label: 'Dashboard' }]} />
    );
    const current = container.querySelector('[aria-current="page"]');
    expect(current).not.toBeNull();
    // A single part has no parent destination.
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });
});
