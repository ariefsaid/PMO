import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ORG_MODULES } from '@/src/lib/repositories/orgSwitches';

// #2746 Administration › Modules: five switches, each saying in plain words what it holds. The three settings that add a step or send
// notices sit inside their module's card; they are stubbed here and tested where they live.
let canManage = true;
const stored: Record<string, boolean> = {};
const mutate = vi.fn();
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => canManage }));
vi.mock('@/src/hooks/useOrgSwitch', () => ({
  useOrgSwitch: (key: string) => ({ data: stored[key] ?? true, refetch: vi.fn() }),
  useSetOrgSwitch: (key: string) => ({ mutate: (on: boolean) => mutate(key, on), reset: vi.fn(), isPending: false, isError: false, error: null }),
}));
vi.mock('@/src/components/stock/TransferModeSettings', () => ({ TransferModeSettings: () => <p>transfer mode setting</p> }));
vi.mock('../materialRequests/ApproverInboxSetting', () => ({ ApproverInboxSetting: () => <p>approvals inbox setting</p> }));
vi.mock('@/src/components/finance/DoneNotClaimedReminder', () => ({ DoneNotClaimedReminder: () => <p>done-not-claimed reminder setting</p> }));
vi.mock('./IdleCostScopeField', () => ({ default: () => <p>idle cost scope setting</p> }));

import OrgModules from './OrgModules';

const NAMES = ['People and crews', 'Site day', 'Stock', 'Purchasing extras', 'Billing extras'];
beforeEach(() => { canManage = true; for (const k of Object.keys(stored)) delete stored[k]; mutate.mockReset(); });

describe('OrgModules (#2746)', () => {
  it('lists the five modules, each on by default, each saying in plain words what it contains', () => {
    render(<OrgModules />);
    expect(ORG_MODULES).toHaveLength(5);
    for (const name of NAMES) expect(screen.getByRole('switch', { name })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/Built-in roles, the clearance checklist for site access, leave requests and crew loans/)).toBeInTheDocument();
    expect(screen.getByText(/Daily safety records, and the cost and schedule performance panels/)).toBeInTheDocument();
    expect(screen.getByText(/Work-order transfers, stock reservations and borrowing/)).toBeInTheDocument();
    expect(screen.getByText(/Purchase line planning, purchase types, payment channels/)).toBeInTheDocument();
    expect(screen.getByText(/Revenue per discipline, the revenue plan, idle time as cost/)).toBeInTheDocument();
  });

  it('an Admin turning a module off sends that module once', async () => {
    render(<OrgModules />);
    await userEvent.click(screen.getByRole('switch', { name: 'Site day' }));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith('moduleSiteDay', false);
  });

  it('the steps and notices that stay off sit inside their module: stock holds two, billing extras one', () => {
    render(<OrgModules />);
    const stock = screen.getByRole('region', { name: 'Stock' });
    expect(within(stock).getByText('transfer mode setting')).toBeInTheDocument();
    expect(within(stock).getByText('approvals inbox setting')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Billing extras' })).getByText('done-not-claimed reminder setting')).toBeInTheDocument();
  });

  it('AC-MV-007 an Admin can enable management views for the organisation', async () => {
    stored.managementViews = false;
    render(<OrgModules />);
    await userEvent.click(screen.getByRole('switch', { name: 'Management views' }));
    expect(mutate).toHaveBeenCalledWith('managementViews', true);
  });

  it('a module that is off hides its own settings (nothing is deleted)', () => {
    stored.moduleStock = false;
    render(<OrgModules />);
    expect(screen.getByRole('switch', { name: 'Stock' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByText('transfer mode setting')).toBeNull();
    expect(screen.queryByText('approvals inbox setting')).toBeNull();
  });

  it('a person who may not change them sees the switches disabled and sends nothing', async () => {
    canManage = false;
    render(<OrgModules />);
    const sw = screen.getByRole('switch', { name: 'Stock' });
    expect(sw).toBeDisabled();
    await userEvent.click(sw);
    expect(mutate).not.toHaveBeenCalled();
  });
});
