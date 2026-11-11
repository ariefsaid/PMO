/**
 * #2061 — the sticky Approve/Reject bar on approval RECORDS.
 *
 * The bar is a placement wrapper only. These tests pin the contract the issue asks for:
 *  - a viewer with no available decision (no permission, SoD-blocked, wrong state) sees NO bar,
 *  - when actions exist, tapping one calls the SAME handler the record already binds,
 *  - it exists on a phone only (desktop keeps the in-flow decision zone).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MobileDecisionBar } from '../MobileDecisionBar';

const state = vi.hoisted(() => ({ narrow: true }));
vi.mock('@/src/components/ui/useIsNarrow', () => ({ useIsNarrow: () => state.narrow }));

beforeEach(() => {
  state.narrow = true;
});

describe('#2061 mobile decision bar', () => {
  it('renders nothing when the record offers no action (no permission / SoD-blocked)', () => {
    render(<MobileDecisionBar actions={[]} />);
    expect(screen.queryByTestId('mobile-decision-bar')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('renders nothing on desktop (the in-flow decision zone owns the action there)', () => {
    state.narrow = false;
    render(
      <MobileDecisionBar
        actions={[{ key: 'approve', label: 'Approve', onSelect: vi.fn() }]}
      />,
    );
    expect(screen.queryByTestId('mobile-decision-bar')).not.toBeInTheDocument();
  });

  it('calls the existing action handler when the approve verb is tapped', async () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    render(
      <MobileDecisionBar
        context="PR-0021 · HV Cabling"
        actions={[
          { key: 'approve', label: 'Approve', variant: 'primary', onSelect: onApprove },
          { key: 'reject', label: 'Reject', onSelect: onReject },
        ]}
      />,
    );
    expect(screen.getByTestId('mobile-decision-bar')).toBeInTheDocument();
    expect(screen.getByText('PR-0021 · HV Cabling')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onReject).not.toHaveBeenCalled();
  });

  it('keeps the 44px touch target and a disabled decision stays disabled', async () => {
    const onSelect = vi.fn();
    render(
      <MobileDecisionBar
        actions={[{ key: 'submit', label: 'Submit for approval', disabled: true, onSelect }]}
      />,
    );
    const button = screen.getByRole('button', { name: 'Submit for approval' });
    expect(button.className).toContain('min-h-11');
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
