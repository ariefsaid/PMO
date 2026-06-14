/**
 * AC-JR-W4-01 — ApprovalRow leading `disclosure` slot.
 *
 * Asserts the new leading-edge disclosure prop renders BEFORE the avatar/name,
 * and that existing layout is unaffected when the prop is omitted.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ApprovalRow } from '../ApprovalRow';

describe('AC-JR-W4-01: ApprovalRow disclosure slot', () => {
  it('AC-JR-W4-01: renders the disclosure node at the leading edge when provided', () => {
    const { container } = render(
      <ApprovalRow
        name="Alice PM"
        week="Week of Jun 2"
        hours={40}
        disclosure={<button data-testid="disc">▶</button>}
      >
        <button>Approve</button>
      </ApprovalRow>,
    );

    const disc = screen.getByTestId('disc');
    const approveBtn = screen.getByRole('button', { name: 'Approve' });
    const row = container.querySelector('[data-approval-row]')!;

    // Both nodes are in the DOM
    expect(disc).toBeInTheDocument();
    expect(approveBtn).toBeInTheDocument();

    // disclosure appears before the avatar span (leading edge)
    const children = Array.from(row.children);
    const discIdx = children.findIndex((el) => el.contains(disc));
    // The avatar span has aria-hidden="true"
    const avatarIdx = children.findIndex(
      (el) => el.getAttribute('aria-hidden') === 'true',
    );
    expect(discIdx).toBeGreaterThanOrEqual(0);
    expect(avatarIdx).toBeGreaterThanOrEqual(0);
    expect(discIdx).toBeLessThan(avatarIdx);
  });

  it('AC-JR-W4-01: existing layout is unaffected when disclosure is omitted', () => {
    const { container } = render(
      <ApprovalRow name="Bob PM" week="Week of Jun 9" hours={38}>
        <button>Return</button>
      </ApprovalRow>,
    );
    const row = container.querySelector('[data-approval-row]')!;
    // First child should be the avatar (no disclosure node preceding it)
    const firstChild = row.children[0];
    expect(firstChild.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByRole('button', { name: 'Return' })).toBeInTheDocument();
  });

  it('AC-JR-W4-01: row uses solid border (not dashed) consistent with ProcurementApprovalRow', () => {
    const { container } = render(
      <ApprovalRow name="Alice PM" week="Week of Jun 2" hours={40} />,
    );
    const row = container.querySelector('[data-approval-row]')!;
    // border-dashed must NOT be present; border-b border-border must be present
    expect(row.className).not.toContain('border-dashed');
    expect(row.className).toContain('border-b');
  });
});
