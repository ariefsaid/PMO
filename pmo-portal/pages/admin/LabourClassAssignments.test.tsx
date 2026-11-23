import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/src/lib/i18n';
import { ToastProvider } from '@/src/components/ui';
import adminId from '@/public/locales/id/administration.json';
import refusalsId from '@/public/locales/id/refusals.json';
import refusalsEn from '@/public/locales/en/refusals.json';

/**
 * AC-NLL-014 (no-login-labour-cost): Admin and Finance give a person with no login a labour class from a date, end it
 * and archive it; a change that would re-cost a costed day shows the catalogue sentence. Others read the list only.
 */
const h = vi.hoisted(() => ({
  assignments: undefined as unknown,
  assignmentsError: false,
  people: [{ id: 'w1', name: 'Budi Santoso', code: 'P-0001' }, { id: 'w2', name: 'Sari Dewi', code: 'P-0002' }],
  repo: { saveAssignment: vi.fn(), endAssignment: vi.fn(), archiveAssignment: vi.fn() },
  refetch: vi.fn(),
}));
vi.mock('@/src/hooks/useLabourCost', () => ({
  useLabourClassAssignments: () => ({ data: h.assignments, isError: h.assignmentsError, refetch: h.refetch }),
  usePeopleWithoutLogin: () => ({ data: h.people, isError: false, isPending: false, refetch: vi.fn() }),
  useLabourCostMutations: () => {
    const wrap = (fn: (...a: never[]) => unknown) => ({ isPending: false, mutate: (v: never, o?: { onSuccess?: () => void; onError?: (e: unknown) => void }) => { Promise.resolve(fn(v)).then(() => o?.onSuccess?.(), (e) => o?.onError?.(e)); }, mutateAsync: async (v: never) => fn(v) });
    return { saveAssignment: wrap(h.repo.saveAssignment), endAssignment: wrap(h.repo.endAssignment), archiveAssignment: wrap(h.repo.archiveAssignment) };
  },
}));
import LabourClassAssignments from './LabourClassAssignments';

const classes = [{ id: 'c1', code: 'direct', name: 'Direct', archivedAt: null }, { id: 'c2', code: 'guard', name: 'Guard', archivedAt: null }];
const row = { id: 'a1', workerId: 'w1', workerName: 'Budi Santoso', classId: 'c2', effectiveFrom: '2026-11-01', effectiveTo: null };
const setup = (canManage = true) => {
  render(<QueryClientProvider client={new QueryClient()}><ToastProvider><LabourClassAssignments classes={classes} canManage={canManage} /></ToastProvider></QueryClientProvider>);
  return userEvent.setup();
};
beforeEach(async () => {
  await i18n.changeLanguage('en');
  h.assignments = [row]; h.assignmentsError = false;
  Object.values(h.repo).forEach((f) => f.mockReset().mockResolvedValue(undefined));
});

describe('AC-NLL-014 crew member classes', () => {
  it('lists each person with their class and period', () => {
    setup();
    const list = screen.getByTestId('labour-class-assignments');
    expect(within(list).getByText('Budi Santoso')).toBeTruthy();
    expect(within(list).getByText('Guard')).toBeTruthy();
  });

  it('an empty list says what is missing and who adds it', () => {
    h.assignments = [];
    setup();
    expect(screen.getByText(/No crew member has a labour class yet/)).toBeTruthy();
    expect(screen.getByText(/Admin or Finance/)).toBeTruthy();
  });

  it('a failed read offers a retry, never an empty list', async () => {
    h.assignments = undefined; h.assignmentsError = true;
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.refetch).toHaveBeenCalled();
  });

  it('Finance assigns a class to a person with no login from a date', async () => {
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Assign a class' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('combobox', { name: /Person/ }));
    await user.click(await screen.findByRole('option', { name: /Sari Dewi/ }));
    await user.selectOptions(within(dialog).getByLabelText(/^Class/), 'c1');
    await user.type(within(dialog).getByLabelText(/^From/), '2026-11-10');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.repo.saveAssignment).toHaveBeenCalledWith({ workerId: 'w2', classId: 'c1', effectiveFrom: '2026-11-10', effectiveTo: null }));
  });

  it('ends an assignment on a chosen last day', async () => {
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'End Budi Santoso' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Last day/), '2026-11-30');
    await user.click(within(dialog).getByRole('button', { name: 'End' }));
    await waitFor(() => expect(h.repo.endAssignment).toHaveBeenCalledWith({ id: 'a1', endDate: '2026-11-30' }));
  });

  it('archiving one that already costs approved days shows what to do instead (English)', async () => {
    h.repo.archiveAssignment.mockRejectedValue(Object.assign(new Error('LCM_CLASS_LOCKED: days are already costed by this class'), { code: '23514' }));
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Archive Budi Santoso' }));
    await user.click(screen.getByRole('button', { name: 'Archive class' }));
    expect((await screen.findAllByText(refusalsEn.LCM_CLASS_LOCKED)).length).toBeGreaterThan(0);
  });

  it('archiving one that already costs approved days shows what to do instead (Bahasa Indonesia)', async () => {
    // The test instance carries no catalogue but refusals (en); load the shipped Indonesian ones for this case.
    i18n.addResourceBundle('id', 'administration', adminId, true, true);
    i18n.addResourceBundle('id', 'refusals', refusalsId, true, true);
    await i18n.changeLanguage('id');
    h.repo.archiveAssignment.mockRejectedValue(Object.assign(new Error('LCM_CLASS_LOCKED: days are already costed by this class'), { code: '23514' }));
    const user = setup();
    await user.click(screen.getByRole('button', { name: /Arsipkan Budi Santoso/ }));
    await user.click(screen.getByRole('button', { name: 'Arsipkan kelas' }));
    expect((await screen.findAllByText(refusalsId.LCM_CLASS_LOCKED)).length).toBeGreaterThan(0);
  });

  it('a reader who cannot manage sees the list and no actions', () => {
    setup(false);
    expect(screen.getByText('Budi Santoso')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Assign a class' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'End Budi Santoso' })).toBeNull();
  });
});
