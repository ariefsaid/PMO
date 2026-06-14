import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

/**
 * Fix #7 — Finance approvals-nav discoverability.
 *
 * Finance approves *procurement* (`policy.ts:124` — `transition: allow([...MASTER_DATA])`
 * where MASTER_DATA includes Finance). The rail must show Approvals to Finance,
 * and `modulesForRole(Finance)` must include `approvals` so ⌘K Navigate matches.
 *
 * Engineer must NOT see Approvals (OD-W2-2 unchanged).
 */

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({
    effectiveRole: testRole,
    realRole: testRole,
    canImpersonate: false,
    viewAs: vi.fn(),
  }),
}));

let testRole: string = 'Finance';

import { Rail } from '../Rail';

const renderRailAs = (role: string) => {
  testRole = role;
  return render(
    <MemoryRouter>
      <Rail />
    </MemoryRouter>,
  );
};

describe('Rail — Finance sees Approvals (fix #7)', () => {
  it('AC-FIX7-RAIL-01: Finance sees the Approvals nav item (procurement approver)', () => {
    renderRailAs('Finance');
    expect(screen.getByRole('link', { name: /approvals/i })).toBeInTheDocument();
  });

  it('AC-FIX7-RAIL-02: Engineer does NOT see Approvals (OD-W2-2 unchanged)', () => {
    renderRailAs('Engineer');
    expect(screen.queryByRole('link', { name: /approvals/i })).not.toBeInTheDocument();
  });
});
