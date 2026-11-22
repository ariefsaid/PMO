import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';

/** #2705 check-in settings card: who sees it at all, the work-order area's validation and writes,
 * and the Admin's outside-area decision role. */
const h = vi.hoisted(() => ({
  canArea: true,
  role: 'Admin',
  workOrderId: null as string | null,
  area: undefined as { lat: number; lng: number; radius_m: number } | undefined,
  supervisorRole: 'engineer' as string | null,
  setArea: { mutateAsync: vi.fn(), isPending: false },
  setRole: { mutate: vi.fn(), isPending: false },
}));
vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => (action: string, entity?: string) => {
    if (action === 'create') return h.canArea;
    if (action === 'manage' && entity === 'checkInSettings') return h.role === 'Admin';
    return true;
  },
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'o1', role: h.role } }) }));
vi.mock('@/src/hooks/usePhoneCheckIn', () => ({
  useWorkOrderArea: (id: string | null) => ({ data: id ? h.area : undefined, isPending: false }),
  useSetWorkOrderArea: () => h.setArea,
  useSupervisorRole: (enabled: boolean) => ({ data: enabled ? h.supervisorRole : undefined, isPending: false }),
  useSetSupervisorRole: () => h.setRole,
}));
vi.mock('./CrewPickers', () => ({
  WorkOrderPicker: ({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) => (
    <select aria-label="Work order" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">Choose a work order</option>
      <option value="w1">WO-1</option>
    </select>
  ),
}));

import { CheckInSettings } from './CheckInSettings';

const view = () => render(<ToastProvider><CheckInSettings /></ToastProvider>);

beforeEach(() => {
  h.canArea = true;
  h.role = 'Admin';
  h.workOrderId = null;
  h.area = undefined;
  h.supervisorRole = 'engineer';
  h.setArea = { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false };
  h.setRole = { mutate: vi.fn(), isPending: false };
});

describe('CheckInSettings', () => {
  it('a person who may not edit work orders and is not an Admin sees nothing', () => {
    h.canArea = false;
    h.role = 'Finance';
    view();
    expect(screen.queryByText('Check-in area')).not.toBeInTheDocument();
  });

  it('an Admin who may not edit work orders sees only the outside-area role decision', () => {
    h.canArea = false;
    h.role = 'Admin';
    view();
    expect(screen.getByText('Check-in area')).toBeInTheDocument();
    expect(screen.getByLabelText('Who decides outside-area check-ins')).toBeInTheDocument();
    expect(screen.queryByLabelText('Work order')).not.toBeInTheDocument();
  });

  it('a work-order writer with no work order chosen offers no area fields yet', () => {
    h.role = 'Project Manager';
    view();
    expect(screen.queryByLabelText('Latitude')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Who decides outside-area check-ins')).not.toBeInTheDocument();
  });

  it('a chosen work order with a saved area prefills the point and radius', async () => {
    h.role = 'Project Manager';
    h.area = { lat: -6.2, lng: 106.8, radius_m: 150 };
    const user = userEvent.setup();
    view();
    await user.selectOptions(screen.getByLabelText('Work order'), 'w1');
    await waitFor(() => expect(screen.getByLabelText('Latitude')).toHaveValue(-6.2));
    expect(screen.getByLabelText('Longitude')).toHaveValue(106.8);
    expect(screen.getByLabelText('Radius (metres)')).toHaveValue(150);
  });

  it('an impossible area is refused in place and nothing is sent', async () => {
    h.role = 'Project Manager';
    const user = userEvent.setup();
    view();
    await user.selectOptions(screen.getByLabelText('Work order'), 'w1');
    await user.type(screen.getByLabelText('Latitude'), '99');
    await user.type(screen.getByLabelText('Longitude'), '106.8');
    await user.type(screen.getByLabelText('Radius (metres)'), '100');
    await user.click(screen.getByRole('button', { name: 'Save area' }));
    expect(screen.getByText('Enter a latitude from -90 to 90, a longitude from -180 to 180 and a radius above 0')).toBeInTheDocument();
    expect(h.setArea.mutateAsync).not.toHaveBeenCalled();
  });

  it('a valid area saves the numbers and confirms with a toast', async () => {
    h.role = 'Project Manager';
    const user = userEvent.setup();
    view();
    await user.selectOptions(screen.getByLabelText('Work order'), 'w1');
    await user.type(screen.getByLabelText('Latitude'), '-6.2');
    await user.type(screen.getByLabelText('Longitude'), '106.8');
    await user.type(screen.getByLabelText('Radius (metres)'), '150');
    await user.click(screen.getByRole('button', { name: 'Save area' }));
    await waitFor(() => expect(h.setArea.mutateAsync).toHaveBeenCalledWith({ workOrderId: 'w1', area: { lat: -6.2, lng: 106.8, radius_m: 150 } }));
    expect((await screen.findAllByText('Area saved')).length).toBeGreaterThan(0);
  });

  it('Clear area sends the null area', async () => {
    h.role = 'Project Manager';
    h.area = { lat: -6.2, lng: 106.8, radius_m: 150 };
    const user = userEvent.setup();
    view();
    await user.selectOptions(screen.getByLabelText('Work order'), 'w1');
    await user.click(await screen.findByRole('button', { name: 'Clear area' }));
    await waitFor(() => expect(h.setArea.mutateAsync).toHaveBeenCalledWith({ workOrderId: 'w1', area: null }));
  });

  it('Clear is unavailable while the work order has no area yet', async () => {
    h.role = 'Project Manager';
    const user = userEvent.setup();
    view();
    await user.selectOptions(screen.getByLabelText('Work order'), 'w1');
    expect(await screen.findByRole('button', { name: 'Clear area' })).toBeDisabled();
  });

  it('a refused area save surfaces the classifier words', async () => {
    h.role = 'Project Manager';
    h.setArea.mutateAsync.mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    view();
    await user.selectOptions(screen.getByLabelText('Work order'), 'w1');
    await user.type(screen.getByLabelText('Latitude'), '-6.2');
    await user.type(screen.getByLabelText('Longitude'), '106.8');
    await user.type(screen.getByLabelText('Radius (metres)'), '150');
    await user.click(screen.getByRole('button', { name: 'Save area' }));
    expect((await screen.findAllByText(/Update failed|boom/)).length).toBeGreaterThan(0);
  });

  it('the Admin changes the outside-area decision role, or back to the default', async () => {
    const user = userEvent.setup();
    view();
    const select = screen.getByLabelText('Who decides outside-area check-ins');
    expect(select).toHaveValue('engineer');
    await user.selectOptions(select, 'planner');
    await waitFor(() => expect(h.setRole.mutate).toHaveBeenCalledWith('planner', expect.objectContaining({ onError: expect.any(Function) })));
    await user.selectOptions(select, '');
    await waitFor(() => expect(h.setRole.mutate).toHaveBeenCalledWith(null, expect.anything()));
  });

  it('a refused role change shows the classifier words in place', async () => {
    const user = userEvent.setup();
    view();
    h.setRole.mutate.mockImplementation((_v: string | null, opts: { onError: (e: unknown) => void }) => opts.onError(new Error('boom')));
    await user.selectOptions(screen.getByLabelText('Who decides outside-area check-ins'), 'planner');
    expect((await screen.findAllByRole('alert')).some((el) => /Update failed|boom/.test(el.textContent ?? ''))).toBe(true);
  });
});
