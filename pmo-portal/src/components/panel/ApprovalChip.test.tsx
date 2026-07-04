/**
 * ApprovalChip tests — Tasks 21–22 (RED then GREEN).
 *
 * AC-AW-013: needs-approval event → chip renders humanSummary + Approve/Deny buttons.
 * AC-AW-016: resolved chip (approved state) is disabled/absent — no re-approval.
 * AC-AW-017: axe-core zero violations on chip in pending, approved, and denied states.
 * AC-AW-014: Approve click calls onApprove; AC-AW-015: Deny click calls onDeny.
 *
 * Note: AC-AW-013..017 wired through AssistantPanel are in AssistantPanel.test.tsx.
 * These tests cover the ApprovalChip component in isolation.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { axeViolations } from '../__tests__/axe';
import { ApprovalChip } from './ApprovalChip';

describe('ApprovalChip', () => {
  const defaultProps = {
    humanSummary: 'Log a call activity on contact XYZ',
    state: 'pending' as const,
    onApprove: vi.fn(),
    onDeny: vi.fn(),
  };

  // ── AC-AW-013: humanSummary visible + Approve + Deny buttons ─────────────────

  it('AC-AW-013 renders humanSummary text in pending state', () => {
    render(<ApprovalChip {...defaultProps} />);
    expect(screen.getByText(/Log a call activity on contact XYZ/i)).toBeInTheDocument();
  });

  it('AC-AW-013 renders Approve and Deny buttons in pending state', () => {
    render(<ApprovalChip {...defaultProps} />);
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /deny/i })).toBeInTheDocument();
  });

  // ── AC-AW-014: Approve click ──────────────────────────────────────────────────

  it('AC-AW-014 clicking Approve calls onApprove', async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn();
    render(<ApprovalChip {...defaultProps} onApprove={onApprove} />);
    await user.click(screen.getByRole('button', { name: /approve/i }));
    expect(onApprove).toHaveBeenCalledOnce();
  });

  // ── AC-AW-015: Deny click ─────────────────────────────────────────────────────

  it('AC-AW-015 clicking Deny calls onDeny', async () => {
    const user = userEvent.setup();
    const onDeny = vi.fn();
    render(<ApprovalChip {...defaultProps} onDeny={onDeny} />);
    await user.click(screen.getByRole('button', { name: /deny/i }));
    expect(onDeny).toHaveBeenCalledOnce();
  });

  // ── AC-AW-016: resolved chip is disabled ─────────────────────────────────────

  it('AC-AW-016 approved state: shows "Approved" text; Approve button absent or disabled', () => {
    render(<ApprovalChip {...defaultProps} state="approved" />);
    // Should show approved text
    expect(screen.getByText(/approved/i)).toBeInTheDocument();
    // Approve button should be absent or disabled (no re-approval)
    const approveBtn = screen.queryByRole('button', { name: /^approve$/i });
    if (approveBtn) {
      expect(approveBtn).toBeDisabled();
    }
    // Deny button should be absent or disabled
    const denyBtn = screen.queryByRole('button', { name: /^deny$/i });
    if (denyBtn) {
      expect(denyBtn).toBeDisabled();
    }
  });

  it('AC-AW-016 denied state: shows "Denied" text; buttons absent or disabled', () => {
    render(<ApprovalChip {...defaultProps} state="denied" />);
    expect(screen.getByText(/denied/i)).toBeInTheDocument();
    const approveBtn = screen.queryByRole('button', { name: /^approve$/i });
    if (approveBtn) {
      expect(approveBtn).toBeDisabled();
    }
  });

  it('AC-AW-016 approving state: buttons disabled while in-flight', () => {
    render(<ApprovalChip {...defaultProps} state="approving" />);
    // During approving, buttons should be disabled
    const buttons = screen.queryAllByRole('button');
    buttons.forEach((btn) => expect(btn).toBeDisabled());
  });

  // ── AC-AW-017: axe-core zero violations ──────────────────────────────────────

  it('AC-AW-017 pending state: axe-core zero blocking violations', async () => {
    const { container } = render(<ApprovalChip {...defaultProps} state="pending" />);
    const { blocking } = await axeViolations(container);
    if (blocking.length > 0) console.error('Axe violations (pending):', blocking);
    expect(blocking).toEqual([]);
  });

  it('AC-AW-017 approved state: axe-core zero blocking violations', async () => {
    const { container } = render(<ApprovalChip {...defaultProps} state="approved" />);
    const { blocking } = await axeViolations(container);
    if (blocking.length > 0) console.error('Axe violations (approved):', blocking);
    expect(blocking).toEqual([]);
  });

  it('AC-AW-017 denied state: axe-core zero blocking violations', async () => {
    const { container } = render(<ApprovalChip {...defaultProps} state="denied" />);
    const { blocking } = await axeViolations(container);
    if (blocking.length > 0) console.error('Axe violations (denied):', blocking);
    expect(blocking).toEqual([]);
  });

  // ── NFR-AW-A11Y-001: aria-live="assertive" ──────────────────────────────────

  it('NFR-AW-A11Y-001 chip has aria-live="assertive"', () => {
    const { container } = render(<ApprovalChip {...defaultProps} />);
    const liveEl = container.querySelector('[aria-live="assertive"]');
    expect(liveEl).toBeInTheDocument();
  });

  // ── Blocker-6: off-palette raw Tailwind literal must not appear on approved text ──
  // DESIGN.md §2 defines --success-text token; text-green-600 bypasses the token pipeline.

  it('Blocker-6 approved state paragraph does NOT use raw text-green-600 class (must use success-text token)', () => {
    const { container } = render(<ApprovalChip {...defaultProps} state="approved" />);
    // Check ALL <p> elements — no paragraph should use the off-palette raw green literal
    const paras = container.querySelectorAll('p');
    paras.forEach((para) => {
      expect(para.className).not.toContain('text-green-600');
    });
  });

  // ── Blocker-9: DESIGN.md §5 Buttons height = 32px (h-8). py-1 gives ~24-28px. ──

  it('Blocker-9 Approve button has h-8 class (32px DESIGN.md control height rule)', () => {
    render(<ApprovalChip {...defaultProps} state="pending" />);
    const approveBtn = screen.getByRole('button', { name: /approve/i });
    expect(approveBtn.className).toContain('h-8');
  });

  it('Blocker-9 Deny button has h-8 class (32px DESIGN.md control height rule)', () => {
    render(<ApprovalChip {...defaultProps} state="pending" />);
    const denyBtn = screen.getByRole('button', { name: /deny/i });
    expect(denyBtn.className).toContain('h-8');
  });

  // ── Review-remediation item 6: labeled "Decision required" header ────────────

  it('item 6: renders a "Decision required" header on the chip container', () => {
    render(<ApprovalChip {...defaultProps} />);
    expect(screen.getByText(/decision required/i)).toBeInTheDocument();
  });
});
