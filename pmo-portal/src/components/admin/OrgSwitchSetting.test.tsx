import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let canManage = true;
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => canManage }));
const state = { data: false as boolean | undefined, isError: false };
const mutate = vi.fn();
const mutation = { mutate, reset: vi.fn(), isPending: false, isError: false, error: null as unknown };
vi.mock('@/src/hooks/useOrgSwitch', () => ({
  useOrgSwitch: () => ({ ...state, refetch: vi.fn() }),
  useSetOrgSwitch: () => mutation,
}));

import { OrgSwitchSetting } from './OrgSwitchSetting';

const card = () => render(<OrgSwitchSetting setting="stockWoTransfers" label="Transfer stock to work orders" helper="Helper text" />);

describe('OrgSwitchSetting (#2746)', () => {
  beforeEach(() => { canManage = true; state.data = false; mutate.mockReset(); mutation.isError = false; mutation.error = null; });

  it('AC-OSM-004 a refusal shows under the switch and the switch keeps the stored value', () => {
    mutation.isError = true;
    mutation.error = Object.assign(new Error('STK_OWNED_BY_ERP: the ERP owns stock for this organisation'), { code: 'P0001' });
    card();
    expect(screen.getByRole('switch', { name: 'Transfer stock to work orders' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(/Stock is managed in your accounting system/)).toBeInTheDocument();
  });

  it('AC-OSM-004 an Admin flipping the switch sends the new value once', async () => {
    card();
    await userEvent.click(screen.getByRole('switch', { name: 'Transfer stock to work orders' }));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith(true);
  });

  it('AC-OSM-005 a person who may not change it sees it disabled with who can, and sends nothing', async () => {
    canManage = false;
    card();
    const sw = screen.getByRole('switch', { name: 'Transfer stock to work orders' });
    expect(sw).toBeDisabled();
    expect(screen.getByText('Only an Admin can change this.')).toBeInTheDocument();
    await userEvent.click(sw);
    expect(mutate).not.toHaveBeenCalled();
  });
});
