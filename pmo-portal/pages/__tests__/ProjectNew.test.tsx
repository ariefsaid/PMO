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

import { render, screen, waitFor, within } from '@testing-library/react';
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

  it('AC-806-CAPTURE: shows origin scope, groups required details before estimate, and keeps classification optional', async () => {
    renderPage();
    const frameHeader = screen.getByTestId('list-page-header');
    expect(within(frameHeader).getByRole('heading', { name: 'New project' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Back to Projects' })).toBeVisible();
    expect(screen.getByText('Workspace scope')).toBeVisible();
    expect(screen.getByText(/Starts as Leads: Leads are tracked in the Pipeline/)).toBeVisible();

    const identity = screen.getByRole('group', { name: 'Project' });
    const ownership = screen.getByRole('group', { name: 'Ownership & schedule' });
    const estimate = screen.getByRole('group', { name: 'Estimate & tax' });
    const classification = screen.getByText('Classification');
    expect(identity.compareDocumentPosition(ownership) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(ownership.compareDocumentPosition(estimate) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(estimate.compareDocumentPosition(classification) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(classification.closest('details')).not.toHaveAttribute('open');

    await userEvent.selectOptions(screen.getByLabelText(/origination stage/i), 'Internal Project');
    expect(screen.getByText(/Starts as Internal Project: Internal projects stay in the workspace/)).toBeVisible();

    await userEvent.click(classification);
    const location = screen.getByLabelText('Location');
    await userEvent.type(location, 'West Java');
    await userEvent.click(classification);
    await userEvent.click(classification);
    expect(screen.getByLabelText('Location')).toHaveValue('West Java');
  });

  it('describes a validated source-list scope and view', () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: '/projects/new', state: { pmoListReturn: { list: 'projects', path: '/projects?filter=Ongoing&view=cards' } } }]}>
        <ToastProvider><ProjectNew /></ToastProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText('Projects scope: Ongoing · Cards')).toBeVisible();
  });

  it('opens Classification and links the invalid field in the submit summary', async () => {
    renderPage();
    await fillValid();
    const summary = screen.getByText('Classification');
    await userEvent.click(summary);
    await userEvent.type(screen.getByLabelText('Location'), 'x'.repeat(141));
    await userEvent.click(screen.getByRole('button', { name: /^Create project$/i }));
    const details = summary.closest('details')!;
    await waitFor(() => expect(details).toHaveAttribute('open'));
    expect(screen.getByRole('link', { name: 'Use 140 characters or fewer.' })).toHaveAttribute('href', '#project-classification-location');
    expect(createMutation).not.toHaveBeenCalled();
  });

  it('returns from the scope line to the validated Projects list context', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Back to Projects' }));
    expect(returnToList).toHaveBeenCalledTimes(1);
  });

  it('AC-PRJ-003: the origination select offers only Leads + Internal Project (never on-hand)', () => {
    renderPage();
    const select = screen.getByLabelText(/origination stage/i) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['Leads', 'Internal Project']);
  });

  it('gates the page: Finance sees a named return instead of the create form', async () => {
    renderPage('Finance');
    expect(screen.queryByLabelText(/project name/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Projects' }));
    expect(returnToList).toHaveBeenCalledTimes(1);
  });

  it('gates the page: Engineer sees a named return instead of the create form', async () => {
    renderPage('Engineer');
    expect(screen.queryByLabelText(/project name/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Projects' }));
    expect(returnToList).toHaveBeenCalledTimes(1);
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
