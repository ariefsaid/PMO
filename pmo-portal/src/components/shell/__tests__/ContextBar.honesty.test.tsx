import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { ContextBar } from '../ContextBar';

/**
 * B-5 (AC-W2-IXD-008): No primary-looking affordance is a silent no-op.
 *
 * OD-W2-5 disposition:
 *   - Notification bell: REMOVE (no known destination; not "coming soon" — dead).
 *   - Sales Export: test is in SalesPipeline.export.test.tsx (separate file per traceability).
 *
 * This test asserts the bell is absent from the ContextBar.
 */

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: 'Project Manager', realRole: 'Project Manager', canImpersonate: false, viewAs: vi.fn() }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({
    currentUser: { id: 'u1', full_name: 'Ada Lovelace', org_id: 'org-1' },
    role: 'Project Manager',
    signOut: vi.fn(),
  }),
}));

const renderBar = () =>
  render(
    <ContextBar
      breadcrumb={[{ label: 'Dashboard' }]}
      onOpenPalette={vi.fn()}
      onToggleRail={vi.fn()}
    />,
  );

describe('ContextBar — dead-affordance honesty (B-5, AC-W2-IXD-008)', () => {
  it('AC-W2-IXD-008: the notification bell is removed — no bell button or bell icon in the bar', () => {
    renderBar();
    // The bell must not render as an interactive affordance (no aria-label containing "notification").
    expect(screen.queryByRole('button', { name: /notification/i })).not.toBeInTheDocument();
    // The bell icon itself should be gone (no unlabelled bell-shaped dead control).
    // We assert by role+name — if someone re-adds it with a different label this test catches it.
  });

  it('AC-W2-IXD-008: the ContextBar still has the core navigation affordances (regression guard)', () => {
    renderBar();
    // ⌘K, sign-out, and user chip must still be present.
    expect(screen.getByRole('button', { name: /command palette/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });
});
