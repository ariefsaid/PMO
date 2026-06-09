import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { GateNotice } from '../GateNotice';

/**
 * AC-IXD-PROC-W5-1 (a11y follow-up, design-reviewer Issue #1): a `blocked` gate
 * is the reason an action is withheld, so it is announced (`role="alert"`). A
 * `ready` gate is static advisory text read in normal reading order — it gets
 * NO live-region role, so it never collides with the toast `role="status"`.
 */
describe('AC-IXD-PROC-W5-1: GateNotice assistive-tech semantics', () => {
  it('AC-IXD-PROC-W5-1: a blocked gate has role="alert" (the reason an action is withheld)', () => {
    render(<GateNotice variant="blocked">A different approver must review this request.</GateNotice>);
    const el = screen.getByRole('alert');
    expect(el).toHaveTextContent(/different approver/i);
  });

  it('AC-IXD-PROC-W5-1: a ready gate is NOT a live region (no status/alert role — reserved for toasts)', () => {
    render(<GateNotice variant="ready">Ready to advance.</GateNotice>);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(/ready to advance/i)).toBeInTheDocument();
  });

  it('AC-IXD-PROC-W5-1: a caller-supplied role overrides the default', () => {
    render(
      <GateNotice variant="blocked" role="note">
        Custom semantics.
      </GateNotice>,
    );
    expect(screen.getByRole('note')).toHaveTextContent(/custom semantics/i);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
