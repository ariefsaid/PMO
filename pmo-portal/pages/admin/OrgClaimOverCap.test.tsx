/** AC-SCS-011 (survey-cap-stop) — Administration › Claims over the claimable quantity: warn by default, Admin-only, English and Bahasa labels. */
import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
import en from '@/public/locales/en/administration.json';
import id from '@/public/locales/id/administration.json';

const h = vi.hoisted(() => ({ canManage: true, get: vi.fn(), set: vi.fn() }));
vi.mock('@/src/lib/repositories/claimOverCap', () => ({ claimOverCapRepository: { get: h.get, set: h.set } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'fixture-admin', org_id: 'fixture-org' } }) }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.canManage }));
import OrgClaimOverCap from './OrgClaimOverCap';

beforeEach(() => {
  vi.clearAllMocks();
  h.canManage = true;
  h.get.mockResolvedValue('warn');
  h.set.mockResolvedValue(undefined);
});

function renderSetting() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ToastProvider><OrgClaimOverCap /></ToastProvider></QueryClientProvider>);
}

it('AC-SCS-011 reads Warn by default and an Admin switches to Refuse', async () => {
  renderSetting();
  const user = userEvent.setup();
  expect(await screen.findByText('Warn only')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Refuse claims over the claimable quantity' }));
  expect(h.set).toHaveBeenCalledWith('fixture-org', 'block');
});

it('AC-SCS-011 an Admin can go back to warning only', async () => {
  h.get.mockResolvedValue('block');
  renderSetting();
  const user = userEvent.setup();
  expect(await screen.findByText('Refuse')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Only warn on claims over the claimable quantity' }));
  expect(h.set).toHaveBeenCalledWith('fixture-org', 'warn');
});

it('AC-SCS-011 a person who cannot change it reads the state, no button, and is told why', async () => {
  h.canManage = false;
  renderSetting();
  expect(await screen.findByText('Warn only')).toBeInTheDocument();
  expect(screen.getByText('Only an Admin can change this.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /claims over the claimable quantity/ })).not.toBeInTheDocument();
});

it('AC-SCS-011 every label exists in English and Bahasa Indonesia', () => {
  const keys = Object.keys((en as { admin: { claimOverCap: object } }).admin.claimOverCap).sort();
  expect(keys.length).toBeGreaterThan(5);
  expect(Object.keys((id as { admin: { claimOverCap: object } }).admin.claimOverCap).sort()).toEqual(keys);
});
