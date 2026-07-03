import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ContextBar } from '../ContextBar';

/**
 * B-5 (AC-W2-IXD-008): No primary-looking affordance is a silent no-op.
 *
 * OD-W2-5's original disposition removed the notification bell for having no
 * known destination. FR-AAN-034/038 (REC-3) gives it a real one — a real
 * unread-count query + inbox popover — so the bell is reinstated, gated behind
 * `agentAssistant`. This test now asserts the HONESTY property that matters:
 * while the flag is off (its real test-env default), no dead no-op bell
 * renders; the core navigation affordances stay present either way.
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
    <MemoryRouter>
      <ContextBar
        breadcrumb={[{ label: 'Dashboard' }]}
        onOpenPalette={vi.fn()}
        onToggleRail={vi.fn()}
      />
    </MemoryRouter>,
  );

describe('ContextBar — dead-affordance honesty (B-5, AC-W2-IXD-008)', () => {
  it('AC-W2-IXD-008: with agentAssistant off, no bell renders (no dead no-op affordance)', () => {
    renderBar();
    // The bell must not render as an interactive affordance (no aria-label containing "notification").
    expect(screen.queryByRole('button', { name: /notification/i })).not.toBeInTheDocument();
  });

  it('AC-W2-IXD-008: the ContextBar still has the core navigation affordances (regression guard)', () => {
    renderBar();
    // ⌘K, sign-out, and user chip must still be present.
    expect(screen.getByRole('button', { name: /command palette/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });
});
