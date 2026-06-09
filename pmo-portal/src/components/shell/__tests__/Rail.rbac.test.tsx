import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

/**
 * B-2 (AC-W2-IXD-003): Role-shaped nav — the Approvals nav item must NOT be shown
 * to ICs who can never approve timesheets.
 *
 * Per OD-W2-2: Engineer approval stays OFF. The Approvals nav is limited to roles
 * that can approve (DELIVERY = Admin·Exec·PM). Engineers never have the Approve/Return
 * affordance so showing them a nav item leads to an empty queue — misleading.
 *
 * Two-sided invariant:
 *  - PM (authorized approver): /approvals nav present.
 *  - Engineer (IC): /approvals nav absent.
 */

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({
    effectiveRole: testRole,
    realRole: testRole,
    canImpersonate: false,
    viewAs: vi.fn(),
  }),
}));

let testRole: string = 'Project Manager';

import { Rail } from '../Rail';

const renderRailAs = (role: string) => {
  testRole = role;
  return render(
    <MemoryRouter>
      <Rail />
    </MemoryRouter>,
  );
};

describe('Rail — role-shaped nav Approvals (B-2, AC-W2-IXD-003)', () => {
  it('AC-W2-IXD-003: a PM sees the Approvals nav item (authorized approver)', () => {
    renderRailAs('Project Manager');
    expect(screen.getByRole('link', { name: /approvals/i })).toBeInTheDocument();
  });

  it('AC-W2-IXD-003: an Engineer does NOT see the Approvals nav item (IC — cannot approve)', () => {
    renderRailAs('Engineer');
    // OD-W2-2: Engineer approval stays OFF. An IC reaching Approvals only sees an empty queue
    // that says "from your reports" — misleading if they have no reports. Remove the nav item.
    expect(screen.queryByRole('link', { name: /approvals/i })).not.toBeInTheDocument();
  });

  it('AC-W2-IXD-003: an Executive sees the Approvals nav item', () => {
    renderRailAs('Executive');
    expect(screen.getByRole('link', { name: /approvals/i })).toBeInTheDocument();
  });

  it('AC-W2-IXD-003: an Admin sees the Approvals nav item', () => {
    renderRailAs('Admin');
    expect(screen.getByRole('link', { name: /approvals/i })).toBeInTheDocument();
  });
});
