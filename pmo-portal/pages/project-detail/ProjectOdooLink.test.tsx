import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { axe } from 'jest-axe';
import { AppError } from '@/src/lib/appError';

const PROJECT = 'p-1';
const h = vi.hoisted(() => ({
  links: { data: undefined as unknown, isPending: false, isError: false, refetch: vi.fn() },
  link: { mutateAsync: vi.fn(), isPending: false },
  unlink: { mutateAsync: vi.fn(), isPending: false },
  plan: { mutateAsync: vi.fn(), isPending: false },
  me: { id: 'u-pm', role: 'Project Manager' as string },
  role: { realRole: 'Project Manager' as string, effectiveRole: 'Project Manager' as string },
}));
vi.mock('@/src/hooks/useOdoo', () => ({
  useOdooProjectLinks: () => h.links,
  useOdooSetup: (verb: string) => ({ 'link-project': h.link, 'unlink-project': h.unlink, 'set-analytic-plan': h.plan }[verb]),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: h.me }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => h.role }));
import { ProjectOdooLink } from './ProjectOdooLink';

const ACCOUNTS = [{ id: '101', code: 'PRJ-1', name: 'Bridge One' }, { id: '102', code: 'PRJ-2', name: 'Bridge Two' }, { id: '103', code: 'PRJ-3', name: 'Bridge Three' }];
beforeEach(() => {
  vi.clearAllMocks();
  h.links.data = { planId: 7, accounts: ACCOUNTS, linked: [] };
  h.links.isPending = false; h.links.isError = false;
  h.me = { id: 'u-pm', role: 'Project Manager' };
  h.role = { realRole: 'Project Manager', effectiveRole: 'Project Manager' };
  for (const m of [h.link, h.unlink, h.plan]) m.mutateAsync.mockResolvedValue({});
});
afterEach(cleanup);
const mount = (managerId: string | null = 'u-pm') => render(<ProjectOdooLink projectId={PROJECT} managerId={managerId} />);

it('AC-ODC-050 the project\'s own manager picks a cost account from the plan and links it', async () => {
  mount();
  fireEvent.change(screen.getByLabelText('Cost account'), { target: { value: '102' } });
  fireEvent.click(screen.getByRole('button', { name: 'Link' }));
  await waitFor(() => expect(h.link.mutateAsync).toHaveBeenCalledWith({ projectId: PROJECT, accountId: '102' }));
});

it('AC-ODC-050 accounts already held by another project are not offered', () => {
  h.links.data = { planId: 7, accounts: ACCOUNTS, linked: [{ projectId: 'p-other', accountId: '101', attention: null }] };
  mount();
  const offered = Array.from((screen.getByLabelText('Cost account') as HTMLSelectElement).options).map((o) => o.value);
  expect(offered).toEqual(['', '102', '103']);
});

it('a linked project shows its cost account and can be unlinked', async () => {
  h.links.data = { planId: 7, accounts: ACCOUNTS, linked: [{ projectId: PROJECT, accountId: '101', attention: null }] };
  mount();
  expect(screen.getByText('PRJ-1 Bridge One')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Unlink' }));
  await waitFor(() => expect(h.unlink.mutateAsync).toHaveBeenCalledWith({ projectId: PROJECT }));
});

it('AC-ODC-054 a link that needs attention says why', () => {
  h.links.data = { planId: 7, accounts: ACCOUNTS, linked: [{ projectId: PROJECT, accountId: '101', attention: 'archived' }] };
  mount();
  expect(screen.getByText(/Needs attention/)).toBeInTheDocument();
  expect(screen.getByText(/archived in Odoo/)).toBeInTheDocument();
});

it('AC-ODC-050 a PM of another project sees the link but no controls', () => {
  h.links.data = { planId: 7, accounts: ACCOUNTS, linked: [{ projectId: PROJECT, accountId: '101', attention: null }] };
  mount('u-someone-else');
  expect(screen.getByText('PRJ-1 Bridge One')).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  cleanup();
  h.links.data = { planId: 7, accounts: ACCOUNTS, linked: [] };
  mount('u-someone-else');
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Cost account')).not.toBeInTheDocument();
});

it('an Engineer, Finance user, or an admin viewing as another role gets no controls; an Admin does', () => {
  for (const role of ['Engineer', 'Finance']) { h.role = { realRole: role, effectiveRole: role }; mount(); expect(screen.queryByRole('button')).not.toBeInTheDocument(); cleanup(); }
  h.role = { realRole: 'Admin', effectiveRole: 'Engineer' }; mount(); expect(screen.queryByRole('button')).not.toBeInTheDocument(); cleanup();
  h.role = { realRole: 'Admin', effectiveRole: 'Admin' }; mount('u-other'); expect(screen.getByRole('button', { name: 'Link' })).toBeInTheDocument();
});

it('a refused link is explained in plain words and keeps the pick', async () => {
  h.link.mutateAsync.mockRejectedValue(new AppError('cost account already linked to PRJ-26-0001', 'REFUSED'));
  mount();
  fireEvent.change(screen.getByLabelText('Cost account'), { target: { value: '102' } });
  fireEvent.click(screen.getByRole('button', { name: 'Link' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/already linked to another project/i);
  expect((screen.getByLabelText('Cost account') as HTMLSelectElement).value).toBe('102');
});

it('with no plan chosen an Admin chooses one; a project manager is told to ask', async () => {
  h.links.data = { planId: null, plans: [{ id: '7', name: 'Projects' }], accounts: [], linked: [] };
  h.role = { realRole: 'Admin', effectiveRole: 'Admin' };
  mount();
  fireEvent.change(screen.getByLabelText('Analytic plan'), { target: { value: '7' } });
  fireEvent.click(screen.getByRole('button', { name: 'Use this plan' }));
  await waitFor(() => expect(h.plan.mutateAsync).toHaveBeenCalledWith({ planId: '7' }));
  cleanup();
  h.role = { realRole: 'Project Manager', effectiveRole: 'Project Manager' };
  mount();
  expect(screen.getByText(/ask an administrator/i)).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

it('a failed read offers a retry', () => {
  h.links.data = undefined; h.links.isError = true;
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(h.links.refetch).toHaveBeenCalled();
});

it('AC-ODC-084 has no axe violations', async () => {
  const { container } = mount();
  expect((await axe(container, { rules: { region: { enabled: false } } })).violations).toEqual([]);
});
