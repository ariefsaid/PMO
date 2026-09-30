/**
 * AC-W2-7-02: the account-menu trigger has ≥44px touch target (touch-target class).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({
    effectiveRole: 'Admin',
    realRole: 'Admin',
    canImpersonate: true,
    viewAs: vi.fn(),
  }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({
    currentUser: { id: 'u1', full_name: 'Ada Lovelace', org_id: 'org-1' },
    role: 'Admin',
    signOut: vi.fn(),
  }),
}));

import { ContextBar } from '../ContextBar';

describe('ContextBar touch target (W2-7)', () => {
  it('AC-W2-7-02: the account-menu trigger has touch-target class for ≥44px coarse-pointer hit area', () => {
    render(
      <ContextBar
        breadcrumb={[{ label: 'Dashboard' }]}
        onOpenPalette={vi.fn()}
        onToggleRail={vi.fn()}
      />,
    );

    // The single account-menu trigger (the sole home of the personal command surface).
    const trigger = screen.getByRole('button', { name: /account menu/i });
    expect(trigger.className).toContain('touch-target');
  });
});