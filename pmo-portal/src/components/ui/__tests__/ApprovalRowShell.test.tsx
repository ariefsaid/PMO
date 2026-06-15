/**
 * AC-JR-W3B-03: ApprovalRowShell — both Timesheet and Procurement rows share the
 * same container classes and leading avatar initial.
 *
 * This test mounts the shared ApprovalRow directly (Timesheet path) and verifies
 * the shell contract that ProcurementApprovalRow must satisfy when rendered via
 * the shared shell:
 *  - gap-3 container (not gap-2)
 *  - py-[11px] vertical padding (not py-3)
 *  - items-center alignment (not items-start)
 *  - leading avatar/initial present
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ApprovalRow } from '../ApprovalRow';

describe('AC-JR-W3B-03: ApprovalRow shell contract', () => {
  it('AC-JR-W3B-03: timesheet row uses gap-3 container', () => {
    const { container } = render(
      <ApprovalRow name="Alice PM" week="Week of Jun 2" hours={40} />,
    );
    const row = container.querySelector('[data-approval-row]')!;
    expect(row.className).toContain('gap-3');
  });

  it('AC-JR-W3B-03: timesheet row uses py-[11px] vertical padding', () => {
    const { container } = render(
      <ApprovalRow name="Bob PM" week="Week of Jun 9" hours={38} />,
    );
    const row = container.querySelector('[data-approval-row]')!;
    expect(row.className).toContain('py-[11px]');
  });

  it('AC-JR-W3B-03: timesheet row uses items-center alignment', () => {
    const { container } = render(
      <ApprovalRow name="Carol PM" week="Week of Jun 16" hours={42} />,
    );
    const row = container.querySelector('[data-approval-row]')!;
    expect(row.className).toContain('items-center');
  });

  it('AC-JR-W3B-03: timesheet row has leading avatar initial', () => {
    render(<ApprovalRow name="Dave PM" week="Week of Jun 23" hours={35} />);
    // Avatar initial is aria-hidden; verify the letter is in the DOM
    const avatar = document.querySelector('[aria-hidden="true"]');
    expect(avatar).not.toBeNull();
    expect(avatar!.textContent).toBe('D');
  });
});
