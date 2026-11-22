import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({
  canManage: true,
  builtInOn: true,
  get: vi.fn(),
  set: vi.fn(),
}));
vi.mock('@/src/lib/repositories', () => ({
  repositories: { procurement: { orderJobRoles: h.get, setOrderJobRoles: h.set, mayOrderPurchases: vi.fn().mockResolvedValue(false) } },
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'usr-1', org_id: 'org-test' } }) }));
vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => (action: string, entity: string) => h.canManage && action === 'manage' && entity === 'orgAccounting',
}));
vi.mock('@/src/hooks/useBuiltInRoles', () => ({ useBuiltInRolesEnabled: () => ({ data: h.builtInOn }) }));
vi.unmock('@/src/hooks/useOrderJobRoles'); // test/setup.ts stubs it for the procurement and shell suites

import OrderJobRolesSection from './OrderJobRolesSection';

const mount = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider><OrderJobRolesSection /></ToastProvider>
  </QueryClientProvider>,
);

beforeEach(() => {
  h.canManage = true; h.builtInOn = true;
  h.get.mockReset().mockResolvedValue([]);
  h.set.mockReset().mockImplementation(async (keys: string[]) => keys);
});

describe('AC-RTD-015 who can order purchases', () => {
  it('an Admin names Buyer and saves the list through the repository', async () => {
    mount();
    expect(await screen.findByText(/No built-in role is named/)).toBeInTheDocument();
    // ordering needs the role held: the approval-step note about people with no built-in role is not shown here
    expect(screen.getByText(/Only people who hold a named built-in role can order/)).toBeInTheDocument();
    expect(screen.queryByText(/People who have no built-in role yet count/)).not.toBeInTheDocument();
    const select = screen.getByLabelText('Add a built-in role') as HTMLSelectElement;
    expect(Array.from(select.options).some((o) => o.value === 'field_user')).toBe(false); // a field role never orders
    await userEvent.selectOptions(select, 'buyer');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByText('Buyer')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.set).toHaveBeenCalledWith(['buyer']));
  });

  it('an Admin removes a named role', async () => {
    h.get.mockResolvedValue(['buyer']);
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Remove Buyer' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.set).toHaveBeenCalledWith([]));
  });

  it('a non-Admin sees the list read-only and the disabled control says why', async () => {
    h.canManage = false;
    h.get.mockResolvedValue(['buyer']);
    mount();
    expect(await screen.findByText('Buyer')).toBeInTheDocument();
    expect(screen.getByLabelText('Add a built-in role')).toBeDisabled();
    expect(screen.getByText('Only an Admin can change this.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('with built-in roles off the control is disabled and says how to turn them on', async () => {
    h.builtInOn = false;
    mount();
    expect(await screen.findByText(/Turn on built-in roles in Administration/)).toBeInTheDocument();
    expect(screen.getByLabelText('Add a built-in role')).toBeDisabled();
  });

  it('a refusal from the database is shown as its sentence', async () => {
    h.set.mockRejectedValue(Object.assign(new Error('PO_JOB_ROLE_OFF: turn on built-in roles before naming roles that order'), { code: 'P0001' }));
    mount();
    await screen.findByText(/No built-in role is named/);
    await userEvent.selectOptions(screen.getByLabelText('Add a built-in role'), 'buyer');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/before naming roles that can order/)).toBeInTheDocument();
  });
});
