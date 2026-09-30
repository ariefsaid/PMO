/**
 * Rail — Operator Administration visibility (ops-admin-surface S4 / AC-ADMIA-002).
 *
 * An authenticated Engineer who is a REAL server-confirmed platform Operator can open
 * `/administration` by URL but could not discover it in the rail. This locks the rail at the
 * real `useIsOperator()` projection — NOT the effective/preview role — so the extra
 * Administration item appears only for a genuine Operator, and stays hidden for a plain Engineer.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';

const { isOperatorState } = vi.hoisted(() => ({ isOperatorState: { value: false } }));

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: 'Engineer', realRole: 'Engineer' }),
}));

// The REAL operator projection drives the extra Administration item — not a preview/effective role.
vi.mock('@/src/auth/useIsOperator', () => ({
  useIsOperator: () => isOperatorState.value,
}));

vi.mock('@/src/hooks/useUserViews', () => ({
  useUserViews: () => ({ data: [], isPending: false, isError: false }),
}));

vi.mock('@/src/hooks/useOrgFeatures', () => ({
  useOrgFeatures: () => ({
    data: {
      incidents: false,
      crm: true,
      procurement: true,
      timesheets: true,
      import_export: true,
      agent_assistant: false,
      user_views: false,
    },
    isPending: false,
    isError: false,
  }),
}));

vi.mock('@/src/lib/features', () => ({
  isFeatureEnabled: () => false,
  FEATURE_ENV_DEFAULT: {},
}));

import { Rail } from '../Rail';

const renderRail = (operatorAccessError = false) =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <Rail operatorAccessError={operatorAccessError} />
    </MemoryRouter>,
  );

describe('Rail — real-Operator Administration visibility (AC-ADMIA-002 / AC-W3-N3)', () => {
  it('shows Administration for an Engineer who is a real Operator', () => {
    isOperatorState.value = true;
    renderRail();
    expect(screen.getByRole('link', { name: 'Administration' })).toHaveAttribute(
      'href',
      '/administration',
    );
  });

  it('keeps Administration hidden for a plain (non-Operator) Engineer', () => {
    isOperatorState.value = false;
    renderRail();
    expect(screen.queryByRole('link', { name: 'Administration' })).not.toBeInTheDocument();
  });

  it('keeps a recoverable Administration path visible when membership cannot be checked', () => {
    isOperatorState.value = false;
    renderRail(true);
    expect(screen.getByRole('link', { name: 'Check Administration access' })).toHaveAttribute(
      'href', '/administration/users',
    );
  });
});
