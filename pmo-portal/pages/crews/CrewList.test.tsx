import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({ create: vi.fn().mockResolvedValue({ id: 'crew' }), placeNew: vi.fn().mockResolvedValue(undefined), crews: [] as unknown[], role: 'Admin', users: [{ id: 'u1', full_name: 'Field user', email: null, status: 'active' }] }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role, effectiveRole: h.role }) }));
vi.mock('@/src/hooks/useUsers', () => ({ useUsers: () => ({ data: h.users }) }));
vi.mock('@/src/hooks/useFkOptions', () => ({ useVendorOptions: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useWorkOrderCosts', () => ({ useCostDisciplines: () => ({ data: [{ id: 'd1', code: 'ME', name: 'Mechanical' }] }) }));
vi.mock('@/src/hooks/useCrews', () => ({
  useCrews: () => ({ data: h.crews, isPending: false, isError: false }),
  useCrewMutations: () => ({ createCrew: { mutateAsync: h.create }, archiveCrew: { mutateAsync: vi.fn() }, placeNewWorker: { mutateAsync: h.placeNew }, place: { mutateAsync: vi.fn() } }),
  useCrewMembers: () => ({ data: [], isPending: false, isError: false }),
  useCrewRoles: () => ({ data: [] }), useCrewWorkers: () => ({ data: [] }),
}));
import { CrewList } from './CrewList';

describe('crew master', () => {
  beforeEach(() => { h.crews = []; h.role = 'Admin'; h.create.mockClear(); h.placeNew.mockClear(); });
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
  it('places a new person with one atomic action', async () => {
    const user = userEvent.setup();
    h.crews = [{ id: 'crew', code: 'C1', name: 'Crew one', kind: 'own', field_controller_id: null, vendor_company_id: null }];
    render(<ToastProvider><CrewList creating={false} onCloseCreate={vi.fn()} onCreate={vi.fn()} /></ToastProvider>);
    await user.click(screen.getByRole('row', { name: /C1 Crew one/ }));
    await user.click(screen.getAllByRole('button', { name: 'Add person' })[0]);
    await user.type(screen.getByRole('textbox', { name: 'Or a new person' }), 'New person');
    await user.selectOptions(screen.getByLabelText('Linked user'), 'u1');
    await user.click(screen.getByRole('button', { name: 'Add person' }));
    await waitFor(() => expect(h.placeNew).toHaveBeenCalledWith(expect.objectContaining({
      person: expect.objectContaining({ display_name: 'New person', profile_id: 'u1' }), placement: expect.objectContaining({ crew_id: 'crew' }),
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
    expect(screen.queryByRole('textbox', { name: 'Or a new person' })).not.toBeInTheDocument();
  });
});
