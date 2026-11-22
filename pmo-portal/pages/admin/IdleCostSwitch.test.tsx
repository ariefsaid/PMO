import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';

/** #2673 (AC-IHC-011): Admin and Finance switch idle cost on; others see it read-only or not at all. */
const h = vi.hoisted(() => ({ role: 'Admin' as string, on: false, labour: true, mutate: vi.fn(), scope: 'labour_average' as string, setScope: vi.fn() }));
vi.mock('@/src/hooks/useIdleCost', () => ({
  useIdleCostEnabled: () => ({ data: h.on, isError: false, refetch: vi.fn() }),
  useSetIdleCostEnabled: () => ({ isPending: false, mutate: h.mutate }),
  useIdleCostScope: () => ({ data: h.scope, isError: false, refetch: vi.fn() }),
  useSetIdleCostScope: () => ({ isPending: false, mutate: h.setScope }),
}));
vi.mock('@/src/hooks/useLabourCost', () => ({ useLabourCostEnabled: () => ({ data: h.labour }) }));
vi.mock('@/src/auth/usePermission', async () => {
  const { can } = await vi.importActual<typeof import('@/src/auth/policy')>('@/src/auth/policy');
  return { usePermission: () => (action: never, entity: never) => can(action, entity, { realRole: h.role } as never) };
});
import IdleCostSwitch from './IdleCostSwitch';

const setup = () => { render(<ToastProvider><IdleCostSwitch /></ToastProvider>); return userEvent.setup(); };
beforeEach(() => { document.body.innerHTML = ''; h.role = 'Admin'; h.on = false; h.labour = true; h.mutate.mockReset(); h.setScope.mockReset(); h.scope = 'labour_average'; });

describe('idle cost switch', () => {
  it('AC-IHC-011 Admin switches it on', async () => {
    const user = setup();
    await user.click(screen.getByRole('checkbox', { name: 'Cost idle hours in money' }));
    await waitFor(() => expect(h.mutate).toHaveBeenCalledWith(true, expect.anything()));
  });
  it('AC-IHC-011 a refusal shows its reason', async () => {
    h.mutate.mockImplementation((_v: boolean, o: { onError: (e: unknown) => void }) => o.onError({ code: '42501', message: 'not authorized' }));
    const user = setup();
    await user.click(screen.getByRole('checkbox', { name: 'Cost idle hours in money' }));
    expect(await screen.findByText('Only an Admin or Finance can change this setting.')).toBeVisible();
  });
  it('AC-IHC-011 Executive sees it but cannot change it', () => {
    h.role = 'Executive';
    setup();
    expect(screen.getByRole('checkbox', { name: 'Cost idle hours in money' })).toBeDisabled();
  });
  it('AC-IHC-002 on without labour cost says nothing shows yet', () => {
    h.on = true; h.labour = false;
    setup();
    expect(screen.getByText('Nothing shows until labour cost in money is switched on.')).toBeVisible();
  });
  it('others do not see the section', () => {
    h.role = 'Engineer';
    const { container } = render(<ToastProvider><IdleCostSwitch /></ToastProvider>);
    expect(container.querySelector('[data-testid="idle-cost-settings"]')).toBeNull();
  });
  it('AC-IWR-012 Admin widens idle cost to people and equipment', async () => {
    h.on = true;
    const user = setup();
    expect(screen.getByRole('combobox', { name: 'Idle cost covers' })).toHaveValue('labour_average');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Idle cost covers' }), 'people_and_equipment');
    await waitFor(() => expect(h.setScope).toHaveBeenCalledWith('people_and_equipment', expect.anything()));
  });
  it('AC-IWR-012 a scope refusal shows its reason', async () => {
    h.on = true;
    h.setScope.mockImplementation((_v: string, o: { onError: (e: unknown) => void }) => o.onError({ code: '42501', message: 'not authorized' }));
    const user = setup();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Idle cost covers' }), 'people_and_equipment');
    expect(await screen.findByText('Only an Admin or Finance can change this setting.')).toBeVisible();
  });
  it('AC-IWR-012 Executive sees the scope but cannot change it', () => {
    h.role = 'Executive'; h.on = true;
    setup();
    expect(screen.getByRole('combobox', { name: 'Idle cost covers' })).toBeDisabled();
  });
  it('AC-IWR-012 the scope is hidden while idle cost is off (nothing to cover yet)', () => {
    setup();
    expect(screen.queryByRole('combobox', { name: 'Idle cost covers' })).toBeNull();
  });
});
