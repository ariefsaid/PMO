/**
 * AC-ROWCLICK-APPROVAL-* — whole-row click on the shared ApprovalRow shell fires
 * onActivate (used by the /approvals action queue to TOGGLE the in-place expand,
 * NOT navigate). Nested controls (the disclosure chevron, action buttons, links,
 * checkboxes) must NOT bubble up to the row onActivate.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApprovalRow } from '../ApprovalRow';

describe('AC-ROWCLICK-APPROVAL: ApprovalRow shell whole-row activation', () => {
  it('AC-ROWCLICK-APPROVAL-1: clicking the row body fires onActivate', async () => {
    const onActivate = vi.fn();
    render(
      <ApprovalRow
        name="Alice PM"
        week="Week of Jun 2"
        hours={40}
        onActivate={onActivate}
      />,
    );
    // Click the (non-interactive) name text → row activates.
    await userEvent.click(screen.getByText('Alice PM'));
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('AC-ROWCLICK-APPROVAL-2: clicking a nested action button does NOT fire onActivate', async () => {
    const onActivate = vi.fn();
    const onApprove = vi.fn();
    render(
      <ApprovalRow name="Bob PM" week="Week of Jun 9" hours={38} onActivate={onActivate}>
        <button type="button" onClick={onApprove}>
          Approve
        </button>
      </ApprovalRow>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('AC-ROWCLICK-APPROVAL-3: clicking the disclosure chevron does NOT double-fire onActivate', async () => {
    const onActivate = vi.fn();
    const onToggle = vi.fn();
    render(
      <ApprovalRow
        name="Carol PM"
        week="Week of Jun 16"
        hours={42}
        onActivate={onActivate}
        disclosure={
          <button type="button" aria-label="Show hours" onClick={onToggle}>
            chev
          </button>
        }
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Show hours' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('AC-ROWCLICK-APPROVAL-4: the row carries cursor-pointer affordance when activatable', () => {
    const { container } = render(
      <ApprovalRow name="Dave PM" week="Week of Jun 23" hours={35} onActivate={vi.fn()} />,
    );
    const row = container.querySelector('[data-approval-row]')!;
    expect(row.className).toContain('cursor-pointer');
  });

  it('AC-ROWCLICK-APPROVAL-5: no onActivate → no cursor-pointer, click is a no-op', async () => {
    const { container } = render(
      <ApprovalRow name="Erin PM" week="Week of Jun 30" hours={30} />,
    );
    const row = container.querySelector('[data-approval-row]')!;
    expect(row.className).not.toContain('cursor-pointer');
    // Clicking does not throw.
    await userEvent.click(screen.getByText('Erin PM'));
  });
});
