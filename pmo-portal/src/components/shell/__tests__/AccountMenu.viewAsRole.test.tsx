import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { Role } from '@/src/auth/AuthContext';

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-1', full_name: 'Pat Doe', org_id: 'org-1' }, signOut: vi.fn() }),
}));
vi.mock('@/src/hooks/useTheme', () => ({ useTheme: () => ({ theme: 'light', setTheme: vi.fn() }) }));
vi.mock('@/src/hooks/useOrgFeatures', () => ({ useOrgFeatures: () => ({ data: {} }) }));

import { AccountMenu } from '../AccountMenu';

async function openMenu(realRole: Role) {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <ImpersonationProvider realRole={realRole} demoEligibility="eligible">
        <AccountMenu />
      </ImpersonationProvider>
    </MemoryRouter>,
  );
  await user.click(screen.getByRole('button', { name: /account menu/i }));
  return user;
}

describe('AccountMenu view-as-role gating through the real impersonation provider', () => {
  it('AC-AUTH-011: a non-Admin has no view-as-role control, even in a demo org', async () => {
    const user = await openMenu('Finance');
    expect(screen.getByRole('menu')).not.toHaveTextContent('View as role');
    await user.keyboard('{Escape}');
    // The same shared menu reopens (the phone layout reuses this one menu) with no section.
    await user.click(screen.getByRole('button', { name: /account menu/i }));
    expect(screen.getByRole('menu')).not.toHaveTextContent('View as role');
  });

  it('AC-AUTH-011 control: a demo-org Admin does see the section', async () => {
    await openMenu('Admin');
    expect(screen.getByRole('menu')).toHaveTextContent('View as role');
  });
});
