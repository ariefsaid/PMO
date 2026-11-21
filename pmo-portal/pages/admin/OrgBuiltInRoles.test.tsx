/** AC-014 (#2709) — Administration › Built-in roles: one setting, off by default, Admin-only. */
import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({ canManage: true, get: vi.fn(), set: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({
  repositories: { orgSettings: { getBuiltInRolesEnabled: h.get, setBuiltInRolesEnabled: h.set } },
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'fixture-admin', org_id: 'fixture-org' } }) }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.canManage }));
import OrgBuiltInRoles from './OrgBuiltInRoles';

beforeEach(() => {
  vi.clearAllMocks();
  h.canManage = true;
  h.get.mockResolvedValue(false);
  h.set.mockResolvedValue(undefined);
});

function renderSetting() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ToastProvider><OrgBuiltInRoles /></ToastProvider></QueryClientProvider>);
}

it('AC-014 reads Off by default and an Admin turns it on', async () => {
  renderSetting();
  const user = userEvent.setup();
  expect(await screen.findByText('Off')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Turn on built-in roles' }));
  expect(h.set).toHaveBeenCalledWith(true);
});

it('AC-014 an Admin can turn it off again', async () => {
  h.get.mockResolvedValue(true);
  renderSetting();
  const user = userEvent.setup();
  expect(await screen.findByText('On')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Turn off built-in roles' }));
  expect(h.set).toHaveBeenCalledWith(false);
});

it('AC-014 a role that cannot change it reads the state and has no button', async () => {
  h.canManage = false;
  renderSetting();
  expect(await screen.findByText('Off')).toBeInTheDocument();
  expect(screen.getByText('Only an Admin can change this.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /built-in roles/ })).not.toBeInTheDocument();
});
