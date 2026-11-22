import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';

/** AC-IWR-012: the "Idle cost covers" choice lives in Administration › Modules › Billing extras (#2746 moved it there). */
const h = vi.hoisted(() => ({ role: 'Admin' as string, on: true, scope: 'labour_average' as string, setScope: vi.fn() }));
vi.mock('@/src/hooks/useIdleCost', () => ({
  useIdleCostEnabled: () => ({ data: h.on, isError: false, refetch: vi.fn() }),
  useIdleCostScope: () => ({ data: h.scope, isError: false, refetch: vi.fn() }),
  useSetIdleCostScope: () => ({ isPending: false, mutate: h.setScope }),
}));
vi.mock('@/src/auth/usePermission', async () => {
  const { can } = await vi.importActual<typeof import('@/src/auth/policy')>('@/src/auth/policy');
  return { usePermission: () => (action: never, entity: never) => can(action, entity, { realRole: h.role } as never) };
});
import IdleCostScopeField from './IdleCostScopeField';

const setup = () => { render(<ToastProvider><IdleCostScopeField /></ToastProvider>); return userEvent.setup(); };
beforeEach(() => { h.role = 'Admin'; h.on = true; h.setScope.mockReset(); h.scope = 'labour_average'; });

describe('idle cost covers field (AC-IWR-012)', () => {
  it('AC-IWR-012 Admin widens idle cost to people and equipment', async () => {
    const user = setup();
    expect(screen.getByRole('combobox', { name: 'Idle cost covers' })).toHaveValue('labour_average');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Idle cost covers' }), 'people_and_equipment');
    await waitFor(() => expect(h.setScope).toHaveBeenCalledWith('people_and_equipment', expect.anything()));
  });
  it('AC-IWR-012 a scope refusal shows its reason', async () => {
    h.setScope.mockImplementation((_v: string, o: { onError: (e: unknown) => void }) => o.onError({ code: '42501', message: 'not authorized' }));
    const user = setup();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Idle cost covers' }), 'people_and_equipment');
    // the toast also mirrors its text into a screen-reader live region, so more than one node carries it
    expect((await screen.findAllByText('Only an Admin or Finance can change this setting.')).length).toBeGreaterThan(0);
  });
  it('AC-IWR-012 Executive sees the scope but cannot change it', () => {
    h.role = 'Executive';
    setup();
    expect(screen.getByRole('combobox', { name: 'Idle cost covers' })).toBeDisabled();
  });
  it('AC-IWR-012 the scope is hidden while idle cost is off (nothing to cover yet)', () => {
    h.on = false;
    const { container } = render(<ToastProvider><IdleCostScopeField /></ToastProvider>);
    expect(container.querySelector('#idle-cost-scope')).toBeNull();
  });
  it('viewers who may not read the labour-cost settings see nothing', () => {
    h.role = 'Engineer';
    const { container } = render(<ToastProvider><IdleCostScopeField /></ToastProvider>);
    expect(container.querySelector('#idle-cost-scope')).toBeNull();
  });
});
