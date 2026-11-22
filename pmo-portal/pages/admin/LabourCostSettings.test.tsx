import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';

/** #2670 (AC-LCM-018): Admin and Finance switch labour cost on, keep classes and rates; others do not see the section. */
const h = vi.hoisted(() => ({
  role: 'Admin' as string,
  enabled: false,
  classes: [{ id: 'c1', code: 'direct', name: 'Direct', archivedAt: null }, { id: 'c2', code: 'guard', name: 'Guard', archivedAt: null }],
  rates: [{ id: 'r1', subjectKind: 'role', personId: null, personName: null, roleKey: 'Engineer', classId: 'c1', basis: 'hourly', amount: '50000.00',
    overtimeMultiplier: '1.50', dayHours: '8.00', monthHours: '173.00', effectiveFrom: '2026-11-01', effectiveTo: null }],
  repo: { setEnabled: vi.fn(), renameClass: vi.fn(), addClass: vi.fn(), archiveClass: vi.fn(), saveRate: vi.fn(), endRate: vi.fn(), archiveRate: vi.fn(),
    saveAssignment: vi.fn(), endAssignment: vi.fn(), archiveAssignment: vi.fn() },
}));
vi.mock('@/src/hooks/useLabourCost', () => ({
  useLabourCostEnabled: () => ({ data: h.enabled, isError: false, refetch: vi.fn() }),
  useLabourClasses: () => ({ data: h.enabled ? h.classes : undefined, isError: false, refetch: vi.fn() }),
  useLabourRates: () => ({ data: h.enabled ? h.rates : undefined, isError: false, refetch: vi.fn() }),
  useLabourClassAssignments: () => ({ data: [], isError: false, refetch: vi.fn() }),
  usePeopleWithoutLogin: () => ({ data: [], isError: false, isPending: false, refetch: vi.fn() }),
  useLabourCostMutations: () => {
    const wrap = (fn: (...a: never[]) => unknown) => ({ isPending: false, mutate: (v: never, o?: { onSuccess?: () => void; onError?: (e: unknown) => void }) => { Promise.resolve(fn(v)).then(() => o?.onSuccess?.(), (e) => o?.onError?.(e)); }, mutateAsync: async (v: never) => fn(v) });
    return {
      setEnabled: wrap(h.repo.setEnabled), addClass: wrap(h.repo.addClass), renameClass: wrap(h.repo.renameClass), archiveClass: wrap(h.repo.archiveClass),
      saveRate: wrap(h.repo.saveRate), endRate: wrap(h.repo.endRate), archiveRate: wrap(h.repo.archiveRate),
      saveAssignment: wrap(h.repo.saveAssignment), endAssignment: wrap(h.repo.endAssignment), archiveAssignment: wrap(h.repo.archiveAssignment),
    };
  },
}));
vi.mock('@/src/hooks/useUsers', () => ({ useUsers: () => ({ data: [{ id: 'u1', full_name: 'Sam', email: 's@example.com', role: 'Engineer' }, { id: 'u2', full_name: 'Pat', email: 'p@example.com', role: 'Finance' }] }) }));
vi.mock('@/src/auth/usePermission', async () => {
  const { can } = await vi.importActual<typeof import('@/src/auth/policy')>('@/src/auth/policy');
  return { usePermission: () => (action: never, entity: never) => can(action, entity, { realRole: h.role } as never) };
});
import LabourCostSettings from './LabourCostSettings';

const setup = () => {
  render(<QueryClientProvider client={new QueryClient()}><ToastProvider><LabourCostSettings /></ToastProvider></QueryClientProvider>);
  return userEvent.setup();
};
beforeEach(() => {
  h.role = 'Admin'; h.enabled = false;
  Object.values(h.repo).forEach((f) => f.mockReset().mockResolvedValue(undefined));
});

describe('AC-LCM-018 labour cost settings', () => {
  it('is OFF by default: the switch is unchecked and no classes or rates show', () => {
    setup();
    expect(screen.getByRole('checkbox', { name: 'Cost approved hours in money' })).not.toBeChecked();
    expect(screen.queryByTestId('labour-rates')).toBeNull();
  });

  it('an Admin switches it on', async () => {
    const user = setup();
    await user.click(screen.getByRole('checkbox', { name: 'Cost approved hours in money' }));
    await waitFor(() => expect(h.repo.setEnabled).toHaveBeenCalledWith(true));
  });

  it('Finance sees the section and can use the switch', () => {
    h.role = 'Finance';
    setup();
    expect(screen.getByRole('checkbox', { name: 'Cost approved hours in money' })).toBeEnabled();
  });

  it('a Project Manager sees nothing', () => {
    h.role = 'Project Manager';
    setup();
    expect(screen.queryByTestId('labour-cost-settings')).toBeNull();
  });

  it('an Executive reads the section but cannot change it', () => {
    h.role = 'Executive'; h.enabled = true;
    setup();
    expect(screen.getByRole('checkbox', { name: 'Cost approved hours in money' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Add rate' })).toBeNull();
    expect(screen.getByText('Engineer')).toBeVisible();
  });

  it('lists classes and rates when on, and renames a class', async () => {
    h.enabled = true;
    const user = setup();
    expect(within(screen.getByTestId('labour-classes')).getByText('Guard')).toBeVisible();
    expect(within(screen.getByTestId('labour-rates')).getByText('Engineer')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Rename Guard' }));
    const dialog = screen.getByRole('dialog');
    const name = within(dialog).getByLabelText(/Name/);
    await user.clear(name); await user.type(name, 'Site guard');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.repo.renameClass).toHaveBeenCalledWith({ id: 'c2', name: 'Site guard' }));
  });

  it('adds a role rate with the entered amount, overtime multiplier and start date', async () => {
    h.enabled = true;
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Add rate' }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText(/^Role/), 'Finance');
    await user.type(within(dialog).getByLabelText(/^Amount/), '75000');
    await user.clear(within(dialog).getByLabelText(/Overtime multiplier/)); await user.type(within(dialog).getByLabelText(/Overtime multiplier/), '2');
    await user.type(within(dialog).getByLabelText(/^From/), '2026-12-01');
    await user.click(within(dialog).getByRole('button', { name: 'Save rate' }));
    await waitFor(() => expect(h.repo.saveRate).toHaveBeenCalledWith(expect.objectContaining({
      subjectKind: 'role', roleKey: 'Finance', classId: 'c1', basis: 'hourly', amount: '75000', overtimeMultiplier: '2', effectiveFrom: '2026-12-01',
    })));
  });

  it('AC-NLL-014 adds a class rate: the class is the subject, no person or role is asked', async () => {
    h.enabled = true;
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Add rate' }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText(/^Applies to/), 'class');
    expect(within(dialog).queryByLabelText(/^Role/)).toBeNull();
    expect(within(dialog).queryByLabelText(/^Person/)).toBeNull();
    await user.selectOptions(within(dialog).getByLabelText(/^Class/), 'c2');
    await user.type(within(dialog).getByLabelText(/^Amount/), '40000');
    await user.type(within(dialog).getByLabelText(/^From/), '2026-12-01');
    await user.click(within(dialog).getByRole('button', { name: 'Save rate' }));
    await waitFor(() => expect(h.repo.saveRate).toHaveBeenCalledWith(expect.objectContaining({ subjectKind: 'class', classId: 'c2', amount: '40000', effectiveFrom: '2026-12-01' })));
  });

  it('AC-NLL-014 a class rate is listed as applying to people with no login in that class, and the crew member classes follow', () => {
    h.enabled = true;
    h.rates = [...h.rates, { id: 'r2', subjectKind: 'class', personId: null, personName: null, roleKey: null, classId: 'c2', basis: 'daily', amount: '400000.00',
      overtimeMultiplier: '1.00', dayHours: '8.00', monthHours: '173.00', effectiveFrom: '2026-11-01', effectiveTo: null }];
    setup();
    const classRow = within(screen.getByTestId('labour-rates')).getByText('People with no login in this class').closest('tr') as HTMLElement;
    expect(within(classRow).getByText('Guard')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Crew member classes' })).toBeVisible();
    h.rates = h.rates.slice(0, 1);
  });

  it('shows the refusal reason when a rate would change priced hours', async () => {
    h.enabled = true;
    h.repo.archiveRate.mockRejectedValue(Object.assign(new Error('LCM_RATE_LOCKED: hours are already priced by this rate'), { code: '23514' }));
    const user = setup();
    const rateRow = within(screen.getByTestId('labour-rates')).getByText('Engineer').closest('tr') as HTMLElement;
    await user.click(within(rateRow).getByRole('button', { name: 'Archive' }));
    await user.click(screen.getByRole('button', { name: 'Archive rate' }));
    await waitFor(() => expect(screen.getAllByText(/would change hours already priced/i).length).toBeGreaterThan(0));
  });
});
