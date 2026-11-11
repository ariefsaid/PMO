/**
 * AC-W2-7-02: the account-menu trigger has a ≥44px target at every pointer setting.
 */
import { describe, it, expect, vi } from 'vitest';
vi.mock('@/src/hooks/useOrgFeatures', () => ({ useOrgFeatures: () => ({ data: {} }) }));
import { render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('@/src/components/shell/NotificationBell', () => ({ NotificationBell: () => null }));
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
  it('AC-W2-7-02: the account-menu trigger has a 44px minimum in addition to the coarse-pointer target', () => {
    render(
      <ContextBar
        breadcrumb={[{ label: 'Dashboard' }]}
        onOpenPalette={vi.fn()}
      />,
    );

    // The single account-menu trigger (the sole home of the personal command surface).
    const trigger = screen.getByRole('button', { name: /account menu/i });
    expect(trigger.className).toContain('touch-target');
    expect(trigger.className.split(/\s+/)).toContain('min-h-11');
    expect(trigger.className.split(/\s+/)).toContain('min-w-11');
  });
});
