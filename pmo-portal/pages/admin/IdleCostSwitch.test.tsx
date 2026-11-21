import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';

/** #2673 (AC-IHC-011): Admin and Finance switch idle cost on; others see it read-only or not at all. */
const h = vi.hoisted(() => ({ role: 'Admin' as string, on: false, labour: true, mutate: vi.fn() }));
vi.mock('@/src/hooks/useIdleCost', () => ({
  useIdleCostEnabled: () => ({ data: h.on, isError: false, refetch: vi.fn() }),
  useSetIdleCostEnabled: () => ({ isPending: false, mutate: h.mutate }),
}));
vi.mock('@/src/hooks/useLabourCost', () => ({ useLabourCostEnabled: () => ({ data: h.labour }) }));
vi.mock('@/src/auth/usePermission', async () => {
  const { can } = await vi.importActual<typeof import('@/src/auth/policy')>('@/src/auth/policy');
  return { usePermission: () => (action: never, entity: never) => can(action, entity, { realRole: h.role } as never) };
});
import IdleCostSwitch from './IdleCostSwitch';

const setup = () => { render(<ToastProvider><IdleCostSwitch /></ToastProvider>); return userEvent.setup(); };
beforeEach(() => { h.role = 'Admin'; h.on = false; h.labour = true; h.mutate.mockReset(); });

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
});
