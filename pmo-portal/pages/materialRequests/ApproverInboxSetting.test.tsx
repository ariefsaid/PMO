/** #2685 AC-MRI-017 — only an Admin sees the toggle, it calls the server function, and it has English and Bahasa Indonesia text. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { readFileSync } from 'node:fs';

const h = vi.hoisted(() => ({ role: 'Admin', get: vi.fn(), set: vi.fn() }));
vi.mock('@/src/lib/repositories/materialRequests', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/repositories/materialRequests')>();
  return { ...actual, materialRequestRepository: { ...actual.materialRequestRepository, approverInbox: h.get, setApproverInbox: h.set,
    chain: async () => [], cutoff: async () => null, standIns: async () => [] } };
});
vi.mock('@/src/hooks/useUsers', () => ({ useUsers: () => ({ data: [] }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1', role: h.role } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role, effectiveRole: h.role }) }));
vi.mock('@/src/components/shell', () => ({ BackBar: () => null }));

import MaterialRequestSettingsPage from '../MaterialRequestSettings';
import { ApproverInboxSetting } from './ApproverInboxSetting';

const renderCard = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider><ApproverInboxSetting /></ToastProvider></QueryClientProvider>);
const renderPage = () => render(
  <MemoryRouter><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider><MaterialRequestSettingsPage /></ToastProvider></QueryClientProvider></MemoryRouter>);

beforeEach(() => { h.get.mockReset(); h.set.mockReset(); h.get.mockResolvedValue(false); h.set.mockResolvedValue(undefined); });

describe('AC-MRI-017 approvals inbox toggle', () => {
  it('an Admin sees it off by default and turning it on calls the server function', async () => {
    h.role = 'Admin';
    renderCard(); // it sits in the Stock module card in Administration (#2746)
    const box = await screen.findByRole('checkbox', { name: /Show material request approvals in the approvals inbox/ });
    await waitFor(() => expect(box).not.toBeDisabled());
    expect(box).not.toBeChecked();
    await userEvent.click(box);
    await waitFor(() => expect(h.set).toHaveBeenCalledWith(true));
  });

  it('the material request settings page no longer carries it, for an Admin too (it moved to the Stock module card)', () => {
    h.role = 'Admin';
    renderPage();
    expect(screen.queryByText('Approvals inbox and notifications')).toBeNull();
    expect(h.get).not.toHaveBeenCalled();
  });

  it('has English and Bahasa Indonesia text for every new key', () => {
    for (const lang of ['en', 'id']) {
      const d = JSON.parse(readFileSync(`public/locales/${lang}/materialRequests.json`, 'utf8'));
      for (const k of ['approverInbox', 'approverInboxSub', 'approverInboxLabel', 'approverInboxError', 'approverInboxSaved']) expect(d.settings[k]).toBeTruthy();
      for (const k of ['scope', 'heading', 'label', 'errorTitle', 'errorSub', 'step', 'standingIn', 'neededBy', 'sent', 'open']) expect(d.inbox[k]).toBeTruthy();
    }
  });
});
