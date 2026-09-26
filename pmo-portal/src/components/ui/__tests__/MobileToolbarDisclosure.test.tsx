/**
 * AC-PRJUX-003 — MobileToolbarDisclosure: a real labelled inline region, not a popover.
 *
 * Locked behaviour:
 *  - trigger `aria-expanded` reflects state and `aria-controls` stays stable;
 *  - the open panel is a labelled `role="region"` in normal flow (won't clip @390);
 *  - focus lands on the first ENABLED interactive descendant on open, skipping a
 *    disabled first child, and falls back to the panel when none is enabled;
 *  - Escape and an outside pointer-down close and restore focus to the trigger;
 *  - normal Tab traversal is preserved (no focus trap); closed/open are axe-clean.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import React from 'react';
import { MobileToolbarDisclosure } from '../MobileToolbarDisclosure';

const renderOpenSubject = () => {
  const onOpenChange = vi.fn();
  const utils = render(
    <MobileToolbarDisclosure label="Filters" onOpenChange={onOpenChange}>
      <select aria-label="Customer">
        <option value="All">All customers</option>
        <option value="c1">Acme</option>
      </select>
      <button type="button">Apply</button>
    </MobileToolbarDisclosure>,
  );
  return { onOpenChange, ...utils };
};

describe('MobileToolbarDisclosure (AC-PRJUX-003)', () => {
  it('AC-PRJUX-003: closed trigger exposes aria-expanded=false and a stable aria-controls target', () => {
    const { container } = renderOpenSubject();
    const trigger = screen.getByRole('button', { name: /Filters/i });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    const controlsId = trigger.getAttribute('aria-controls');
    expect(controlsId).toBeTruthy();
    // Panel not open, so the controls target does not exist yet — but the id is stable
    // once open (asserted below).
    expect(container.querySelector(`#${controlsId}`)).not.toBeInTheDocument();
  });

  it('AC-PRJUX-003: opening yields a labelled inline region with the same aria-controls id', async () => {
    const user = userEvent.setup();
    const { container } = renderOpenSubject();
    const trigger = screen.getByRole('button', { name: /Filters/i });
    const controlsId = trigger.getAttribute('aria-controls');
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const panel = container.querySelector(`#${controlsId}`);
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveAttribute('role', 'region');
    expect(within(panel as HTMLElement).getByRole('combobox', { name: /Customer/i })).toBeInTheDocument();
  });

  it('AC-PRJUX-003: on open, focus moves to the first ENABLED interactive descendant', async () => {
    const user = userEvent.setup();
    renderOpenSubject();
    await user.click(screen.getByRole('button', { name: /Filters/i }));
    expect(screen.getByRole('combobox', { name: /Customer/i })).toHaveFocus();
  });

  it('AC-PRJUX-003: a disabled first child is skipped in favour of the next enabled one', async () => {
    const user = userEvent.setup();
    render(
      <MobileToolbarDisclosure label="Filters">
        <select aria-label="Customer" disabled>
          <option>All</option>
        </select>
        <button type="button">Apply</button>
      </MobileToolbarDisclosure>,
    );
    await user.click(screen.getByRole('button', { name: /Filters/i }));
    expect(screen.getByRole('button', { name: /Apply/i })).toHaveFocus();
  });

  it('AC-PRJUX-003: when every descendant is disabled, focus falls back to the open panel', async () => {
    const user = userEvent.setup();
    render(
      <MobileToolbarDisclosure label="Filters">
        <button type="button" disabled>
          Hidden
        </button>
      </MobileToolbarDisclosure>,
    );
    const trigger = screen.getByRole('button', { name: /Filters/i });
    await user.click(trigger);
    // The panel region receives focus (tabIndex=-1).
    const panel = document.getElementById(trigger.getAttribute('aria-controls')!);
    expect(panel).toHaveFocus();
  });

  it('AC-PRJUX-003: Escape closes the disclosure and restores focus to the trigger', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderOpenSubject();
    const trigger = screen.getByRole('button', { name: /Filters/i });
    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('AC-PRJUX-003: an outside pointer-down closes it and restores focus to the trigger', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderOpenSubject();
    const trigger = screen.getByRole('button', { name: /Filters/i });
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    // Pointer-down outside the wrapper — on the document body.
    fireEvent.pointerDown(document.body);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('AC-PRJUX-003: a dialog scrim does not unmount an open action disclosure before the dialog closes', async () => {
    const user = userEvent.setup();
    renderOpenSubject();
    const trigger = screen.getByRole('button', { name: /Filters/i });
    await user.click(trigger);
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);
    try {
      fireEvent.pointerDown(document.body);
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
    } finally {
      dialog.remove();
    }
  });

  it('AC-PRJUX-003: a closed inert dialog in the app shell does not block Escape or outside dismissal', async () => {
    const user = userEvent.setup();
    renderOpenSubject();
    const closedAssistant = document.createElement('section');
    closedAssistant.setAttribute('role', 'dialog');
    closedAssistant.setAttribute('inert', '');
    closedAssistant.style.display = 'none';
    document.body.appendChild(closedAssistant);
    try {
      const trigger = screen.getByRole('button', { name: /Filters/i });
      await user.click(trigger);
      await user.keyboard('{Escape}');
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await user.click(trigger);
      fireEvent.pointerDown(document.body);
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
    } finally {
      closedAssistant.remove();
    }
  });

  it('AC-PRJUX-003: clicking the trigger is not treated as an outside event (normal toggle)', async () => {
    const user = userEvent.setup();
    renderOpenSubject();
    const trigger = screen.getByRole('button', { name: /Filters/i });
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('AC-PRJUX-003: Tab traversal works normally — no focus trap keeps focus inside', async () => {
    const user = userEvent.setup();
    render(
      <MobileToolbarDisclosure label="Filters">
        <button type="button">One</button>
        <button type="button">Two</button>
      </MobileToolbarDisclosure>,
    );
    await user.click(screen.getByRole('button', { name: /Filters/i }));
    // First child focused on open.
    expect(screen.getByRole('button', { name: /One/i })).toHaveFocus();
    // Tab moves to the second child (normal navigation within the open region).
    await user.tab();
    expect(screen.getByRole('button', { name: /Two/i })).toHaveFocus();
  });

  it('AC-PRJUX-003: count badge renders on the trigger when count > 0', () => {
    render(
      <MobileToolbarDisclosure label="Filters" count={2}>
        <button type="button">One</button>
      </MobileToolbarDisclosure>,
    );
    expect(screen.getByTestId('mobile-toolbar-count')).toHaveTextContent('2');
  });

  it('AC-PRJUX-003: controlled open/onOpenChange drives the panel', () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <MobileToolbarDisclosure label="Filters" open={false} onOpenChange={onOpenChange}>
        <button type="button">One</button>
      </MobileToolbarDisclosure>,
    );
    const trigger = screen.getByRole('button', { name: /Filters/i });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    rerender(
      <MobileToolbarDisclosure label="Filters" open onOpenChange={onOpenChange}>
        <button type="button">One</button>
      </MobileToolbarDisclosure>,
    );
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('AC-PRJUX-003: the closed disclosure is axe-clean', async () => {
    const { container } = render(
      <MobileToolbarDisclosure label="Filters" count={0}>
        <button type="button">Apply</button>
      </MobileToolbarDisclosure>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('AC-PRJUX-003: the open disclosure is axe-clean', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <MobileToolbarDisclosure label="Filters">
        <button type="button">Apply</button>
      </MobileToolbarDisclosure>,
    );
    await user.click(screen.getByRole('button', { name: /Filters/i }));
    expect(await axe(container)).toHaveNoViolations();
  });
});
