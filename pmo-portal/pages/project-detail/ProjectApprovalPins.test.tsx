import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AppError } from '@/src/lib/appError';

const PROJECT = 'p-1';
const h = vi.hoisted(() => ({
  chain: { data: undefined as unknown, isPending: false, isError: false, refetch: vi.fn() },
  pins: { data: undefined as unknown, isPending: false, isError: false, refetch: vi.fn() },
  users: { data: undefined as unknown },
  setPin: { mutateAsync: vi.fn(), isPending: false },
  toast: vi.fn(),
  role: { realRole: 'Project Manager' as string, effectiveRole: 'Project Manager' as string },
  me: { id: 'u-pm' },
}));
vi.mock('@/src/hooks/useMaterialRequests', () => ({
  useApprovalChain: () => h.chain, useStepPins: () => h.pins, useMaterialRequestMutations: () => ({ setStepPin: h.setPin }),
}));
vi.mock('@/src/hooks/useUsers', () => ({ useUsers: () => h.users }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => h.role }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: h.me }) }));
vi.mock('@/src/components/ui', async (orig) => ({ ...(await orig<object>()), useToast: () => ({ toast: h.toast }) }));
import { ProjectApprovalPins } from './ProjectApprovalPins';

const mount = (managerId: string | null = 'u-pm') => render(<ProjectApprovalPins projectId={PROJECT} managerId={managerId} />);

beforeEach(() => {
  vi.clearAllMocks();
  h.chain.data = [{ id: 's1', position: 1, role: 'Engineer', label: 'Plan check' }, { id: 's3', position: 3, role: 'Finance', label: 'Stock' }];
  h.pins.data = [];
  h.users.data = [
    { id: 'u5', full_name: 'Fin One', role: 'Finance', status: 'active' }, { id: 'u6', full_name: 'Fin Two', role: 'Finance', status: 'active' },
    { id: 'u7', full_name: 'Fin Gone', role: 'Finance', status: 'disabled' }, { id: 'u4', full_name: 'Eng One', role: 'Engineer', status: 'active' },
  ];
  h.role = { realRole: 'Project Manager', effectiveRole: 'Project Manager' };
  h.me = { id: 'u-pm' };
  h.setPin.mutateAsync.mockResolvedValue(undefined);
});
afterEach(cleanup);

it('AC-MRQ-016 the project manager pins a step to an active member who holds its role, and only those are offered', async () => {
  mount();
  const select = screen.getByLabelText('Step 3: Stock') as HTMLSelectElement;
  expect(Array.from(select.options).map((o) => o.value)).toEqual(['', 'u5', 'u6']);
  fireEvent.change(select, { target: { value: 'u6' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(h.setPin.mutateAsync).toHaveBeenCalledWith({ projectId: PROJECT, position: 3, approverId: 'u6' }));
});

it('AC-MRQ-020 choosing "Anyone with the role" clears the pin', async () => {
  h.pins.data = [{ position: 3, role: 'Finance', approverId: 'u6' }];
  mount();
  fireEvent.change(screen.getByLabelText('Step 3: Stock'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(h.setPin.mutateAsync).toHaveBeenCalledWith({ projectId: PROJECT, position: 3, approverId: null }));
});

it('AC-MRQ-016 a pin whose role no longer matches the chain step shows as unpinned', () => {
  h.pins.data = [{ position: 3, role: 'Engineer', approverId: 'u4' }];
  mount();
  expect((screen.getByLabelText('Step 3: Stock') as HTMLSelectElement).value).toBe('');
});

it('AC-MRQ-016 someone who is neither Admin nor the manager sees the pins read-only, with no controls', () => {
  h.pins.data = [{ position: 3, role: 'Finance', approverId: 'u6' }];
  h.me = { id: 'u-eng' };
  mount('u-other');
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(screen.getByText('Pinned to Fin Two')).toBeTruthy();
  expect(screen.getByText('Any Engineer')).toBeTruthy();
});

it('AC-MRQ-016 a view-as session gets no controls', () => {
  h.role = { realRole: 'Admin', effectiveRole: 'Engineer' };
  mount();
  expect(screen.queryByRole('combobox')).toBeNull();
});

it('AC-MRQ-017 the server\'s refusal is shown as a plain sentence', async () => {
  h.setPin.mutateAsync.mockRejectedValue(new AppError('MRQ_PIN_INVALID: the approver must be an active member who holds the step\'s role', 'P0001'));
  mount();
  fireEvent.change(screen.getByLabelText('Step 3: Stock'), { target: { value: 'u5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent("Choose an active member who holds this step's role.");
});

it('AC-MRQ-024 a pin whose person was deactivated or lost the role is flagged as needing attention, and the step reads as role-level', () => {
  h.chain.data = [{ id: 's3', position: 3, role: 'Finance', label: 'Stock' }];
  h.pins.data = [{ position: 3, role: 'Finance', approverId: 'u7' }];
  mount();
  expect(screen.getByRole('status')).toHaveTextContent('Fin Gone can no longer decide this step. Anyone with the role can until you choose someone else.');
  cleanup();
  h.users.data = [{ id: 'u6', full_name: 'Fin Two', role: 'Engineer', status: 'active' }];
  h.pins.data = [{ position: 3, role: 'Finance', approverId: 'u6' }];
  mount();
  expect(screen.getByRole('status')).toBeTruthy();
});

it('AC-MRQ-024 a live pin shows no warning, and the read-only view says the pin needs attention', () => {
  h.chain.data = [{ id: 's3', position: 3, role: 'Finance', label: 'Stock' }];
  h.pins.data = [{ position: 3, role: 'Finance', approverId: 'u6' }];
  mount();
  expect(screen.queryByRole('status')).toBeNull();
  cleanup();
  h.pins.data = [{ position: 3, role: 'Finance', approverId: 'u7' }];
  h.me = { id: 'u-eng' };
  mount('u-other');
  expect(screen.getByRole('status')).toBeTruthy();
});

it('no chain set: nothing to pin, the panel stays out of the way', () => {
  h.chain.data = [];
  const { container } = mount();
  expect(container.firstChild).toBeNull();
});

it('AC-RTD-007 a step naming a built-in role offers only the people who fill it, and keeps a pin recorded for that role', () => {
  h.chain.data = [{ id: 's2', position: 2, role: 'Project Manager', jobRole: 'construction_manager', label: 'Site check' }];
  h.users.data = [
    { id: 'c1', full_name: 'Con One', role: 'Project Manager', built_in_role: 'construction_manager', status: 'active' },
    { id: 'c2', full_name: 'Proj One', role: 'Project Manager', built_in_role: 'project_manager', status: 'active' },
    { id: 'c3', full_name: 'Plain PM', role: 'Project Manager', built_in_role: null, status: 'active' },
    { id: 'c4', full_name: 'Con Gone', role: 'Project Manager', built_in_role: 'construction_manager', status: 'disabled' },
  ];
  h.pins.data = [{ position: 2, role: 'Project Manager', jobRole: 'construction_manager', approverId: 'c1' }];
  mount();
  const select = screen.getByLabelText('Step 2: Site check') as HTMLSelectElement;
  expect(Array.from(select.options).map((o) => o.value)).toEqual(['', 'c1', 'c3']);
  expect(select.value).toBe('c1');
});
