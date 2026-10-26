/** AC-W2-7-02: the named Account control opens its menu. */
import { describe, it, expect, vi } from 'vitest';
vi.mock('@/src/hooks/useOrgFeatures', () => ({ useOrgFeatures: () => ({ data: {} }) }));
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router';

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
    currentUser: { id: 'u1', full_name: 'Portal User', org_id: 'org-1' },
    role: 'Admin',
    signOut: vi.fn(),
  }),
}));

import { ContextBar } from '../ContextBar';

describe('ContextBar touch target (W2-7)', () => {
  it('AC-W2-7-02: the named Account control opens its menu', () => {
    render(
      <MemoryRouter>
        <ContextBar
          breadcrumb={[{ label: 'Dashboard' }]}
          onOpenPalette={vi.fn()}
          onToggleRail={vi.fn()}
        />
      </MemoryRouter>,
    );

    const trigger = screen.getByRole('button', { name: /account menu/i });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu', { name: /account menu/i })).toBeInTheDocument();
  });
});
