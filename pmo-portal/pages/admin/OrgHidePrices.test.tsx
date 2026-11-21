/** AC-010 (#2699) — Administration › Hide prices from requesters: one setting, off by default, Admin-only, English and Bahasa labels. */
import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
import en from '@/public/locales/en/administration.json';
import id from '@/public/locales/id/administration.json';

const h = vi.hoisted(() => ({ canManage: true, get: vi.fn(), set: vi.fn() }));
vi.mock('@/src/lib/repositories/hidePrices', () => ({ hidePricesRepository: { getEnabled: h.get, setEnabled: h.set } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'fixture-admin', org_id: 'fixture-org' } }) }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.canManage }));
import OrgHidePrices from './OrgHidePrices';

beforeEach(() => {
  vi.clearAllMocks();
  h.canManage = true;
  h.get.mockResolvedValue(false);
  h.set.mockResolvedValue(undefined);
});

function renderSetting() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ToastProvider><OrgHidePrices /></ToastProvider></QueryClientProvider>);
}

it('AC-010 reads Off by default and an Admin turns it on', async () => {
  renderSetting();
  const user = userEvent.setup();
  expect(await screen.findByText('Off')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Hide prices from requesters' }));
  expect(h.set).toHaveBeenCalledWith(true);
});

it('AC-010 an Admin can turn it off again', async () => {
  h.get.mockResolvedValue(true);
  renderSetting();
  const user = userEvent.setup();
  expect(await screen.findByText('On')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Show prices to requesters again' }));
  expect(h.set).toHaveBeenCalledWith(false);
});

it('AC-010 a person who cannot change it reads the state and has no button', async () => {
  h.canManage = false;
  renderSetting();
  expect(await screen.findByText('Off')).toBeInTheDocument();
  expect(screen.getByText('Only an Admin can change this.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /prices/i })).not.toBeInTheDocument();
});

it('AC-010 every label exists in English and Bahasa Indonesia', () => {
  const keys = Object.keys((en as { admin: { hidePrices: object } }).admin.hidePrices).sort();
  expect(keys.length).toBeGreaterThan(5);
  expect(Object.keys((id as { admin: { hidePrices: object } }).admin.hidePrices).sort()).toEqual(keys);
});
