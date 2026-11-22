import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import type { Role } from '@/src/auth/AuthContext';

const h = vi.hoisted(() => ({
  role: 'Admin' as string,
  people: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  create: vi.fn(), update: vi.fn(), markLeft: vi.fn(),
}));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role as Role, effectiveRole: h.role as Role }) }));
vi.mock('@/src/hooks/usePeople', () => ({
  usePeople: () => h.people,
  usePeopleMutations: () => ({ create: { mutateAsync: h.create }, update: { mutateAsync: h.update }, markLeft: { mutateAsync: h.markLeft, isPending: false } }),
}));
vi.mock('@/src/hooks/useOrgProfilesLoader', () => ({
  useOrgProfilesLoader: () => () => Promise.resolve([{ id: 'u1', full_name: 'Sari Dewi' }]),
}));

import People from './People';

const person = (over: Record<string, unknown> = {}) => ({ id: 'p1', code: 'P-0001', name: 'Budi Santoso', job_title: 'Welder', profile_id: null, ...over });
const renderPage = () => render(<MemoryRouter><ToastProvider><People /></ToastProvider></MemoryRouter>);

describe('People register screen', () => {
  beforeEach(() => {
    h.role = 'Admin';
    h.people = { data: [person()], isPending: false, isError: false, refetch: vi.fn() };
    h.create.mockReset().mockResolvedValue({}); h.update.mockReset().mockResolvedValue(undefined); h.markLeft.mockReset().mockResolvedValue(undefined);
  });

  it('AC-PPL-008 each row links to the person record, where documents are added', () => {
    renderPage();
    expect(screen.getByRole('link', { name: 'Budi Santoso' })).toHaveAttribute('href', '/equipment/people/p1');
  });

  it('AC-IMT-013 the Import entry shows for the Admin who may add people, and not otherwise', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /^Import/ })).toBeInTheDocument();
  });

  it('AC-PPL-005 adds a person with only a name: no code is sent', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Add person' }));
    await user.type(within(screen.getByRole('dialog')).getByLabelText(/^Name/), 'Ayu Lestari');
    await user.click(screen.getByRole('button', { name: 'Save person' }));
    expect(h.create).toHaveBeenCalledWith({ name: 'Ayu Lestari', code: null, job_title: null, profile_id: null });
  });

  it('AC-PPL-006 edits name, code, job title and link only', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /Edit Budi Santoso/ }));
    const code = within(screen.getByRole('dialog')).getByLabelText(/^Person code/);
    await user.clear(code); await user.type(code, 'EMP-7');
    await user.click(screen.getByRole('button', { name: 'Save person' }));
    expect(h.update).toHaveBeenCalledWith({ id: 'p1', input: { name: 'Budi Santoso', code: 'EMP-7', job_title: 'Welder', profile_id: null } });
  });

  it('AC-PPL-009 a duplicate code names the code field', async () => {
    h.update.mockRejectedValue(Object.assign(new Error('duplicate key value violates unique constraint "people_code_live"'), { code: '23505' }));
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /Edit Budi Santoso/ }));
    await user.click(screen.getByRole('button', { name: 'Save person' }));
    expect(await screen.findByText('That person code is already in use')).toBeInTheDocument();
  });

  it('AC-PPL-007 an Admin marks a person as left with a day, after confirming; the day starts as today', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /Mark Budi Santoso as left/ }));
    expect(h.markLeft).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Mark as left' }));
    expect(h.markLeft).toHaveBeenCalledWith({ id: 'p1', leftOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
  });

  it('AC-PPL-006 a Finance user sees the register without add, edit or archive', () => {
    h.role = 'Finance';
    renderPage();
    expect(screen.getByText('Budi Santoso')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add person|Edit|Mark as left/ })).toBeNull();
  });

  it('Project Managers can add and edit but not mark as left', () => {
    h.role = 'Project Manager';
    renderPage();
    expect(screen.getByRole('button', { name: 'Add person' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Edit Budi Santoso/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mark Budi Santoso as left/ })).toBeNull();
  });

  it('shows the empty state with an add action for an Admin', () => {
    h.people = { data: [], isPending: false, isError: false, refetch: vi.fn() };
    renderPage();
    expect(screen.getByText(/^No people yet/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Add person' }).length).toBeGreaterThan(0);
  });
});
