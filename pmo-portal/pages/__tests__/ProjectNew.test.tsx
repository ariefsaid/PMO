/**
 * One-step project create (#806): `/projects/new` is a full page with the whole header editable
 * inline. Nothing is written until Save; Save replaces the URL with the saved record; leaving a
 * dirty page asks first; the page is gated exactly like the old create action.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/src/hooks/useProjectClassificationOptions', () => ({
  useProjectClassificationOptions: () => ({ data: { serviceLines: [], sectors: [] }, isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useOrgTaxDefault', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useOrgTaxDefault: () => 'exclusive' };
});
vi.mock('@/src/hooks/useProjectNumberProposal', () => ({
  useProjectNumberProposal: (clientId: string | null) => clientId
    ? { status: 'success', number: 'PMO-2026-TEST-0001', error: null }
    : { status: 'idle', number: null, error: null },
}));

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { findToastAnnouncement } from '@/src/components/ui/__tests__/toastTestQueries';
import { AppError } from '@/src/lib/appError';

const { roleBox, createMutation, navigate, returnToList } = vi.hoisted(() => ({
  roleBox: { value: 'Project Manager' },
  createMutation: vi.fn(),
  navigate: vi.fn(),
  returnToList: vi.fn(),
}));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useCompanies', () => ({ useCompanies: () => ({ data: [], isError: false }) }));
vi.mock('@/src/hooks/useProjects', () => ({
  useClientCompanies: () => ({ data: [{ id: 'c2', name: 'Innovate Corp', type: 'Client' }] }),
  useProjectManagers: () => ({ data: [{ id: 'u-alice', full_name: 'Alice Manager' }] }),
  useProjectMutations: () => ({ create: { mutateAsync: createMutation, isPending: false } }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: roleBox.value, realRole: roleBox.value, canImpersonate: false, viewAs: vi.fn() }),
}));
vi.mock('@/src/hooks/useListReturn', () => ({ useListReturn: () => ({ openRecord: vi.fn(), returnToList }) }));
vi.mock('react-router', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => navigate };
});

import ProjectNew from '../ProjectNew';

const renderPage = (role = 'Project Manager') => {
  roleBox.value = role;
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/projects/new', state: { pmoListReturn: { list: 'projects' } } }]}>
      <ToastProvider>
        <ProjectNew />
      </ToastProvider>
    </MemoryRouter>,
  );
};

async function fillValid(name = 'Harborside Terminal') {
  await userEvent.type(screen.getByLabelText(/project name/i), name);
  await userEvent.click(screen.getByRole('combobox', { name: /client company/i }));
  const listbox = await screen.findByRole('listbox', { name: /compan/i });
  await userEvent.click(screen.getByRole('option', { name: /Innovate Corp/i }));
  expect(listbox).toBeTruthy();
}

describe('ProjectNew — one-step create page (#806)', () => {
  beforeEach(() => {
    navigate.mockClear();
    returnToList.mockClear();
    createMutation.mockReset();
  });

  it('renders the whole header as a page (no dialog) and writes nothing on arrival', () => {
    renderPage();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /new project/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/project name/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Create project$/i })).toBeDisabled();
    expect(createMutation).not.toHaveBeenCalled();
  });

  it('AC-PRJ-003: the origination select offers only Leads + Internal Project (never on-hand)', () => {
    renderPage();
    const select = screen.getByLabelText(/origination stage/i) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['Leads', 'Internal Project']);
  });

  it('gates the page like the old create action: Finance sees no form', () => {
    renderPage('Finance');
    expect(screen.queryByLabelText(/project name/i)).not.toBeInTheDocument();
  });

  it('Save creates the project once and REPLACES the URL with its record, keeping list context', async () => {
    createMutation.mockResolvedValue({ id: 'project-new', erpSetup: 'ready' });
    renderPage();
    await fillValid();
    await userEvent.click(screen.getByRole('button', { name: /^Create project$/i }));
    await waitFor(() =>
      expect(createMutation).toHaveBeenCalledWith(expect.objectContaining({ name: 'Harborside Terminal', client_id: 'c2', status: 'Leads' })),
    );
    expect(createMutation).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('/projects/project-new', {
        replace: true,
        state: { pmoListReturn: { list: 'projects' } },
      }),
    );
  });

  it('AC-RAM-006: a successful Save names the project; an ERP-pending result warns and still names it', async () => {
    createMutation.mockResolvedValue({ id: 'project-new', erpSetup: 'pending' });
    renderPage();
    await fillValid('Harborside Annex');
    await userEvent.click(screen.getByRole('button', { name: /^Create project$/i }));
    const toast = await findToastAnnouncement('alert', /ERP linking needs attention/);
    expect(toast).toHaveTextContent(/Harborside Annex/);
  });

  it('a failed Save stays on the page with the entries and a classified warning', async () => {
    createMutation.mockRejectedValue(new AppError('denied', '42501'));
    renderPage();
    await fillValid('Blocked Project');
    await userEvent.click(screen.getByRole('button', { name: /^Create project$/i }));
    const toast = await findToastAnnouncement('alert', /don't have permission/i);
    expect(toast).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/project name/i)).toHaveValue('Blocked Project');
  });

  it('Cancel on a pristine page returns to the list at once; nothing is created', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    expect(returnToList).toHaveBeenCalledTimes(1);
    expect(createMutation).not.toHaveBeenCalled();
  });

  it('Cancel on a dirty page asks first: Stay keeps it, Leave returns to the list', async () => {
    renderPage();
    await userEvent.type(screen.getByLabelText(/project name/i), 'Half typed');
    await userEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    expect(returnToList).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Stay$/i }));
    expect(returnToList).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    await userEvent.click(await screen.findByRole('button', { name: /^Leave$/i }));
    expect(returnToList).toHaveBeenCalledTimes(1);
    expect(createMutation).not.toHaveBeenCalled();
  });
});
