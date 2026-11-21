/** AC-DPR-015 (#2669) — Administration: an Admin turns profit per discipline on; others only read it. */
import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';

vi.unmock('@/pages/admin/OrgDisciplineProfit'); // test/setup.ts stubs it for the Administration suites
const h = vi.hoisted(() => ({ canManage: true, get: vi.fn(), set: vi.fn() }));
vi.mock('@/src/lib/repositories/disciplineProfit', () => ({ disciplineProfitRepository: { isEnabled: h.get, setEnabled: h.set } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'a', org_id: 'o' } }) }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.canManage }));
import OrgDisciplineProfit from './OrgDisciplineProfit';

beforeEach(() => { vi.clearAllMocks(); h.canManage = true; h.get.mockResolvedValue(false); h.set.mockResolvedValue(undefined); });

const renderIt = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider><OrgDisciplineProfit /></ToastProvider></QueryClientProvider>);

it('AC-DPR-001 reads off by default and AC-DPR-015 an Admin turns it on', async () => {
  renderIt();
  const user = userEvent.setup();
  const select = await screen.findByRole('combobox', { name: 'Show revenue next to cost per discipline' });
  expect(select).toHaveValue('off');
  await user.selectOptions(select, 'On');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(h.set).toHaveBeenCalledWith(true));
});

it('AC-DPR-015 a role without the right reads the value and cannot change it', async () => {
  h.canManage = false;
  renderIt();
  expect(await screen.findByText('Only an Admin can change this.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
});
