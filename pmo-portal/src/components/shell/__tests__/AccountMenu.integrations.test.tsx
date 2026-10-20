import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';

/** FIN-S9: "My integrations" lives in the account menu (the rail no longer carries it). */
const h = vi.hoisted(() => ({ m365: true as boolean | undefined }));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-1', full_name: 'Pat Doe', org_id: 'org-1' }, signOut: vi.fn() }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: 'Engineer', effectiveRole: 'Engineer', canImpersonate: false, viewAs: vi.fn() }),
}));
vi.mock('@/src/hooks/useTheme', () => ({ useTheme: () => ({ theme: 'light', setTheme: vi.fn() }) }));
vi.mock('@/src/hooks/useOrgFeatures', () => ({
  useOrgFeatures: () => ({ data: h.m365 === undefined ? {} : { m365_integration: h.m365 } }),
}));

import { AccountMenu } from '../AccountMenu';

const open = async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><AccountMenu /></MemoryRouter>);
  await user.click(screen.getByRole('button', { name: 'Account menu' }));
};

beforeEach(() => { h.m365 = true; });

describe('FIN-S9: account menu hosts My integrations', () => {
  it('links to /integrations once, when the m365 entitlement is on', async () => {
    await open();
    const items = screen.getAllByRole('menuitem', { name: 'My integrations' });
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveAttribute('href', '/integrations');
  });

  it('shows no dead link when the org is not entitled', async () => {
    h.m365 = false;
    await open();
    expect(screen.queryByRole('menuitem', { name: 'My integrations' })).not.toBeInTheDocument();
  });
});
