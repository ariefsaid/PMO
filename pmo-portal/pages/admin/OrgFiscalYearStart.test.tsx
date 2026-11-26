/**
 * AC-FCAL-014 (#2329) — Administration › Accounting › Fiscal year: an Admin of an organization with no accounting
 * system sets the month its fiscal year starts; others read it; an accounting system keeps its own calendar.
 */
import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({ canManage: true, get: vi.fn(), set: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({
  repositories: { orgSettings: { getFiscalYearSetting: h.get, setFiscalYearStartMonth: h.set } },
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'fixture-admin', org_id: 'fixture-org' } }) }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.canManage }));
import OrgFiscalYearStart from './OrgFiscalYearStart';

beforeEach(() => {
  vi.clearAllMocks();
  h.canManage = true;
  h.get.mockResolvedValue({ source: 'pmo', startMonth: null });
  h.set.mockResolvedValue(undefined);
});

function renderSetting() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ToastProvider><OrgFiscalYearStart /></ToastProvider></QueryClientProvider>);
  return client;
}

it('AC-FCAL-014 an Admin picks April, reads what the change does, and saves it', async () => {
  renderSetting();
  const user = userEvent.setup();
  const select = await screen.findByRole('combobox', { name: 'Fiscal year starts in' });
  expect(select).toHaveValue('');
  expect(screen.getByText(/places each payment in a fiscal year by its date/)).toBeInTheDocument();
  await user.selectOptions(select, 'April');
  expect(h.set).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Save fiscal year' }));
  expect(h.set).toHaveBeenCalledWith(4);
  expect((await screen.findAllByText('Fiscal year saved')).length).toBeGreaterThan(0);
});

it('AC-FCAL-014 an Admin can clear the start month', async () => {
  h.get.mockResolvedValue({ source: 'pmo', startMonth: 4 });
  renderSetting();
  const user = userEvent.setup();
  const select = await screen.findByRole('combobox', { name: 'Fiscal year starts in' });
  expect(select).toHaveValue('4');
  expect(screen.getByRole('button', { name: 'Save fiscal year' })).toBeDisabled();
  await user.selectOptions(select, 'Not set');
  await user.click(screen.getByRole('button', { name: 'Save fiscal year' }));
  expect(h.set).toHaveBeenCalledWith(null);
});

it('AC-FCAL-014 a role that cannot change it reads the value and has no writer', async () => {
  h.canManage = false;
  h.get.mockResolvedValue({ source: 'pmo', startMonth: 4 });
  renderSetting();
  expect(await screen.findByText('April')).toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: 'Fiscal year starts in' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save fiscal year' })).not.toBeInTheDocument();
});

it('AC-FCAL-014 where an accounting system is read, it sets the fiscal year and PMO offers no control', async () => {
  h.get.mockResolvedValue({ source: 'accounting_system', startMonth: null });
  renderSetting();
  expect(await screen.findByText('Your accounting system sets the fiscal year.')).toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: 'Fiscal year starts in' })).not.toBeInTheDocument();
});

it('AC-FCAL-014 a refused save keeps the choice and says why', async () => {
  h.set.mockRejectedValue(new Error('only an Admin can set the fiscal year'));
  renderSetting();
  const user = userEvent.setup();
  await user.selectOptions(await screen.findByRole('combobox', { name: 'Fiscal year starts in' }), 'April');
  await user.click(screen.getByRole('button', { name: 'Save fiscal year' }));
  expect(await screen.findByText(/only an Admin can set the fiscal year/i)).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Fiscal year starts in' })).toHaveValue('4');
});

it('AC-FCAL-014 a failed read offers retry and no writer', async () => {
  h.get.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ source: 'pmo', startMonth: 1 });
  renderSetting();
  const user = userEvent.setup();
  expect(await screen.findByText("Couldn't load the fiscal year")).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save fiscal year' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /retry|try again/i }));
  expect(await screen.findByRole('combobox', { name: 'Fiscal year starts in' })).toHaveValue('1');
});
