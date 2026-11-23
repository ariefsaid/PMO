import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';

/** AC-MPN-008: the form sends the chosen position, head count and optional work order; the work order list follows the project; a refusal reads as its sentence. */
const h = vi.hoisted(() => ({ create: vi.fn(), positions: [{ id: 'd1', code: 'WLD', name: 'Welder' }] as unknown[] }));
vi.mock('@/src/hooks/useManpowerNeeds', () => ({ useManpowerMutations: () => ({ create: { mutateAsync: h.create } }) }));
vi.mock('@/src/hooks/useWorkOrderCosts', () => ({ useCostDisciplines: () => ({ data: h.positions, isSuccess: true }) }));
vi.mock('@/src/hooks/useProjects', () => ({ useProjectPickerOptions: () => ({ data: [{ id: 'pr1', name: 'Site One' }, { id: 'pr2', name: 'Site Two' }] }) }));
vi.mock('@/src/hooks/useCrews', () => ({
  useCrews: () => ({ data: [] }),
  useCrewWorkOrders: () => ({ data: [{ id: 'w1', wo_number: 'WO-1', title: 'Shutdown', project_id: 'pr1' }, { id: 'w2', wo_number: 'WO-2', title: 'Other', project_id: 'pr2' }] }),
}));
import { ManpowerNeedForm } from './ManpowerNeedForm';

const view = () => render(<ToastProvider><ManpowerNeedForm onClose={vi.fn()} /></ToastProvider>);

describe('AC-MPN-008 manpower need form', () => {
  beforeEach(() => { h.create.mockReset(); h.positions = [{ id: 'd1', code: 'WLD', name: 'Welder' }]; });

  it('offers only the chosen project\'s work orders and sends the need without org_id', async () => {
    const user = userEvent.setup();
    h.create.mockResolvedValue(undefined);
    view();
    await user.selectOptions(screen.getByRole('combobox', { name: /Project/ }), 'pr1');
    expect(screen.queryByRole('option', { name: /WO-2/ })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: /Position/ }), 'd1');
    await user.selectOptions(screen.getByRole('combobox', { name: /Work order/ }), 'w1');
    await user.clear(screen.getByLabelText(/Headcount/));
    await user.type(screen.getByLabelText(/Headcount/), '4');
    await user.click(screen.getByRole('button', { name: 'Record need' }));
    await waitFor(() => expect(h.create).toHaveBeenCalledWith(expect.objectContaining({
      project_id: 'pr1', discipline_id: 'd1', headcount: 4, work_order_id: 'w1', crew_id: null,
    })));
    expect(h.create.mock.calls[0][0]).not.toHaveProperty('org_id');
  });

  it('a duplicate link refusal never reads as a duplicate crew code', async () => {
    const user = userEvent.setup();
    h.create.mockRejectedValue({ code: '23505', message: 'MPN_DUPLICATE: this person is already linked to this need' });
    view();
    await user.selectOptions(screen.getByRole('combobox', { name: /Project/ }), 'pr1');
    await user.selectOptions(screen.getByRole('combobox', { name: /Position/ }), 'd1');
    await user.click(screen.getByRole('button', { name: 'Record need' }));
    expect(await screen.findByText(/already linked to this need/)).toBeInTheDocument();
  });

  it('with no positions it says who adds them and cannot be submitted', () => {
    h.positions = [];
    view();
    expect(screen.getByText(/An Admin adds them on the Cost disciplines screen/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record need' })).toBeDisabled();
  });
});
