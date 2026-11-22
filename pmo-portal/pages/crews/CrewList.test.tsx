import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({ create: vi.fn().mockResolvedValue({ id: 'crew' }), placeNew: vi.fn().mockResolvedValue(undefined), crews: [] as unknown[], role: 'Admin', users: [{ id: 'u1', full_name: 'Field user', email: null, status: 'active' }], members: [] as unknown[], roles: [] as unknown[], workers: [] as unknown[], setRole: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role, effectiveRole: h.role }) }));
vi.mock('@/src/hooks/useUsers', () => ({ useUsers: () => ({ data: h.users }) }));
vi.mock('@/src/hooks/useFkOptions', () => ({ useVendorOptions: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useWorkOrderCosts', () => ({ useCostDisciplines: () => ({ data: [{ id: 'd1', code: 'ME', name: 'Mechanical' }] }) }));
vi.mock('@/src/hooks/useCrews', () => ({
  useCrews: () => ({ data: h.crews, isPending: false, isError: false }),
  useCrewMutations: () => ({ createCrew: { mutateAsync: h.create }, archiveCrew: { mutateAsync: vi.fn() }, placeNewWorker: { mutateAsync: h.placeNew }, place: { mutateAsync: vi.fn() }, setPlacementRole: { mutateAsync: h.setRole, isPending: false } }),
  useCrewMembers: () => ({ data: h.members, isPending: false, isError: false }),
  useCrewRoles: () => ({ data: h.roles }), useCrewWorkers: () => ({ data: h.workers }),
}));
import { CrewList } from './CrewList';

describe('crew master', () => {
  beforeEach(() => { h.members = []; h.roles = []; h.workers = []; h.setRole.mockClear(); h.crews = []; h.role = 'Admin'; h.create.mockClear(); h.placeNew.mockClear(); });
  it('creates a crew with the selected discipline', async () => {
    const user = userEvent.setup();
    render(<ToastProvider><CrewList creating onCloseCreate={vi.fn()} onCreate={vi.fn()} /></ToastProvider>);
    await user.type(screen.getByRole('textbox', { name: 'Code' }), 'CREW');
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Crew name');
    await user.selectOptions(screen.getByLabelText('Discipline'), 'd1');
    expect(screen.getByRole('textbox', { name: 'Code' })).toHaveValue('CREW');
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Crew name');
    expect(screen.getByRole('button', { name: 'Create crew' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Create crew' }));
    await waitFor(() => expect(h.create).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ discipline_id: 'd1' }) })));
  });
  it('fix/walk-people item 7: one field picks someone or types a new name, and places them with one atomic action; no login field here', async () => {
    const user = userEvent.setup();
    h.crews = [{ id: 'crew', code: 'C1', name: 'Crew one', kind: 'own', field_controller_id: null, vendor_company_id: null }];
    render(<ToastProvider><CrewList creating={false} onCloseCreate={vi.fn()} onCreate={vi.fn()} /></ToastProvider>);
    await user.click(screen.getByRole('row', { name: /C1 Crew one/ }));
    await user.click(screen.getAllByRole('button', { name: 'Add person' })[0]);
    expect(screen.queryByRole('textbox', { name: 'Or a new person' })).toBeNull();
    expect(screen.queryByLabelText('Linked user')).toBeNull();
    await user.click(screen.getByRole('combobox', { name: 'Person' }));
    await user.type(await screen.findByRole('combobox', { name: /^Search people/ }), 'New person');
    await user.click(await screen.findByRole('option', { name: /Add "New person" as a new person/ }));
    await user.click(screen.getByRole('button', { name: 'Add person' }));
    await waitFor(() => expect(h.placeNew).toHaveBeenCalledWith(expect.objectContaining({
      person: expect.objectContaining({ display_name: 'New person', profile_id: null }), placement: expect.objectContaining({ crew_id: 'crew' }),
    })));
  });
  it('lets an Executive select existing people without offering person creation', async () => {
    const user = userEvent.setup();
    h.role = 'Executive';
    h.crews = [{ id: 'crew', code: 'C1', name: 'Crew one', kind: 'own', field_controller_id: null, vendor_company_id: null }];
    render(<ToastProvider><CrewList creating={false} onCloseCreate={vi.fn()} onCreate={vi.fn()} /></ToastProvider>);
    await user.click(screen.getByRole('row', { name: /C1 Crew one/ }));
    await user.click(screen.getAllByRole('button', { name: 'Add person' })[0]);
    expect(screen.getByRole('combobox', { name: 'Person' })).toBeInTheDocument();
    expect(screen.queryByText(/as a new person/)).not.toBeInTheDocument();
  });
  it('fix/walk-people item 6: a person with no crew role says so and one action sets it, keeping their dates', async () => {
    const user = userEvent.setup();
    h.crews = [{ id: 'crew', code: 'C1', name: 'Crew one', kind: 'own', field_controller_id: null, vendor_company_id: null }];
    h.workers = [{ id: 'w1', display_name: 'Ana' }];
    h.roles = [{ id: 'r1', name: 'Welder' }];
    h.members = [{ id: 'm1', crew_id: 'crew', worker_id: 'w1', standard_role_id: null, valid_from: '2026-01-01', valid_to: null, version: 3 }];
    render(<ToastProvider><CrewList creating={false} onCloseCreate={vi.fn()} onCreate={vi.fn()} /></ToastProvider>);
    await user.click(screen.getByRole('row', { name: /C1 Crew one/ }));
    expect(screen.getByText('Crew role not set')).toBeInTheDocument();
    const memberRow = screen.getByText('Crew role not set').closest('tr')!;
    await user.click(within(memberRow).getByRole('button', { name: /actions/i }));
    await user.click(await screen.findByRole('menuitem', { name: 'Set crew role' }));
    await user.selectOptions(within(screen.getByRole('dialog')).getByLabelText(/^Crew role/), 'r1');
    await user.click(screen.getByRole('button', { name: 'Save crew role' }));
    await waitFor(() => expect(h.setRole).toHaveBeenCalledWith({ id: 'm1', version: 3, valid_from: '2026-01-01', valid_to: null, standard_role_id: 'r1' }));
  });
});
