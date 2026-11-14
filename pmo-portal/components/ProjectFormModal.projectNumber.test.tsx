import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe, toHaveNoViolations } from 'jest-axe';
import 'jest-axe/extend-expect'; // global registration moved out of test/setup.ts (unit-speed #1584)
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';

expect.extend(toHaveNoViolations);
const h = vi.hoisted(() => ({
  proposeNumber: vi.fn(),
  canManageNumbering: true,
  permissionCalls: [] as Array<[string, string]>,
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { project: { proposeNumber: h.proposeNumber } } }));
vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => (action: string, entity: string) => {
    h.permissionCalls.push([action, entity]);
    return h.canManageNumbering && action === 'manage' && entity === 'orgProjectNumbering';
  },
}));
vi.mock('@/src/hooks/useProjects', () => ({
  useClientCompanies: () => ({ data: [
    { id: 'client-1', name: 'Acme Client', type: 'Client' },
    { id: 'client-2', name: 'Northstar Client', type: 'Client' },
  ], isError: false }),
  useProjectManagers: () => ({ data: [], isError: false }),
}));
vi.mock('@/src/hooks/useProjectClassificationOptions', () => ({ useProjectClassificationOptions: () => ({ data: { serviceLines: [], sectors: [] }, isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useCompanies', () => ({ useCompanies: () => ({ data: [], isError: false }) }));
vi.mock('@/src/hooks/useOrgTaxDefault', () => ({ useOrgTaxDefault: () => 'exclusive', useTaxTreatmentPreselect: () => undefined }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useTaxTreatmentOptions', () => ({ useTaxTreatmentOptions: () => ({ placeholder: 'Choose', options: [] }) }));

import ProjectFormModal from './ProjectFormModal';

function renderModal(onSubmit = vi.fn().mockResolvedValue(undefined)) {
  const view = render(
    <MemoryRouter>
      <ToastProvider>
        <ProjectFormModal onClose={vi.fn()} onSubmit={onSubmit} onError={vi.fn()} />
      </ToastProvider>
    </MemoryRouter>,
  );
  return { ...view, onSubmit };
}

function renderPageForm() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <ProjectFormModal variant="page" onClose={vi.fn()} onSubmit={vi.fn()} onError={vi.fn()} />
      </ToastProvider>
    </MemoryRouter>,
  );
}

async function selectClient(name = 'Acme Client') {
  await userEvent.click(screen.getByRole('combobox', { name: /client company/i }));
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(name, 'i') }));
}

beforeEach(() => {
  vi.clearAllMocks();
  h.canManageNumbering = true;
  h.permissionCalls.length = 0;
  h.proposeNumber.mockResolvedValue('RIS-26-0001');
});
afterEach(() => cleanup());

describe('AC-CODE-002 ProjectFormModal', () => {
  it('proposes an editable PMO number and sends the separate optional Client Project Code', async () => {
    const { onSubmit } = renderModal();
    const number = screen.getByLabelText(/pmo project number/i);
    expect(number).toHaveAttribute('placeholder', 'Set after the client');
    expect(screen.queryByText('Assigned automatically once you choose a client.')).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/project name/i), 'Site Upgrade');
    await selectClient();
    await waitFor(() => expect(number).toHaveValue('RIS-26-0001'));
    expect(number).toBeEnabled();
    expect(screen.getByText(/Change it before creating/)).toBeInTheDocument();
    const clientCode = screen.getByLabelText(/client project code/i);
    expect(clientCode).toHaveAttribute('placeholder', 'Optional');
    expect(screen.getByText('Code used by your organization.')).toBeInTheDocument();
    await userEvent.clear(number);
    await userEvent.type(number, 'RIS-26-EDITED');
    await userEvent.type(clientCode, 'CLIENT-77');
    expect(h.proposeNumber).toHaveBeenCalledWith('client-1');
    expect(await axe(document.body)).toHaveNoViolations();
    await userEvent.click(screen.getByRole('button', { name: /create project/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      pmo_project_number: 'RIS-26-EDITED', code: 'CLIENT-77', name: 'Site Upgrade', client_id: 'client-1',
    })));
  });

  it('links the PMO number field to numbering settings for users allowed to change the pattern', async () => {
    renderPageForm();
    await userEvent.type(screen.getByLabelText(/project name/i), 'Site Upgrade');
    await selectClient();
    await screen.findByDisplayValue('RIS-26-0001');
    const link = screen.getByRole('link', { name: /numbering settings/i });
    expect(link).toHaveAttribute('href', '/administration/projects#org-project-number-pattern');
    expect(h.permissionCalls).toContainEqual(['manage', 'orgProjectNumbering']);
  });

  it('links the missing client-segment error to project numbering settings', async () => {
    h.proposeNumber.mockRejectedValueOnce(new Error('project_number_client_segment_required'));
    renderPageForm();
    await userEvent.type(screen.getByLabelText(/project name/i), 'Site Upgrade');
    await selectClient();
    expect(await screen.findByText(/selected company needs a client number segment/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /numbering settings/i })).toHaveAttribute('href', '/administration/projects#org-project-number-pattern');
  });

  it('hides the numbering-settings link when the user cannot change that setting', async () => {
    h.canManageNumbering = false;
    renderPageForm();
    await userEvent.type(screen.getByLabelText(/project name/i), 'Site Upgrade');
    await selectClient();
    await screen.findByDisplayValue('RIS-26-0001');
    expect(screen.queryByRole('link', { name: /numbering settings/i })).not.toBeInTheDocument();
    expect(h.permissionCalls).toContainEqual(['manage', 'orgProjectNumbering']);
  });

  it('turns a duplicate PMO number into an actionable field error and retains the entered value', async () => {
    const { onSubmit } = renderModal(vi.fn().mockRejectedValue({ code: '23505', message: 'duplicate key on pmo_project_number' }));
    await userEvent.type(screen.getByLabelText(/project name/i), 'Site Upgrade');
    await selectClient();
    const number = await screen.findByLabelText(/pmo project number/i);
    await userEvent.clear(number);
    await userEvent.type(number, 'RIS-26-TAKEN');
    await userEvent.click(screen.getByRole('button', { name: /create project/i }));
    await waitFor(() => expect(screen.getAllByText(/already in use/i).length).toBeGreaterThan(0));
    expect(number).toHaveAttribute('aria-invalid', 'true');
    expect(number).toHaveValue('RIS-26-TAKEN');
    expect(onSubmit).toHaveBeenCalled();
  });

  it('clears the old proposal and duplicate error when the client changes', async () => {
    h.proposeNumber.mockImplementation(async (clientId: string) => clientId === 'client-1' ? 'RIS-26-0001' : 'NORTH-26-0002');
    const onSubmit = vi.fn().mockRejectedValue({ code: '23505', message: 'duplicate key on pmo_project_number' });
    renderModal(onSubmit);
    await userEvent.type(screen.getByLabelText(/project name/i), 'Site Upgrade');
    await selectClient();
    const number = await screen.findByLabelText(/pmo project number/i);
    await waitFor(() => expect(number).toHaveValue('RIS-26-0001'));
    await userEvent.clear(number);
    await userEvent.type(number, 'RIS-26-TAKEN');
    await userEvent.click(screen.getByRole('button', { name: /create project/i }));
    expect(await screen.findByText(/already in use/i)).toBeInTheDocument();

    await selectClient('Northstar Client');
    await waitFor(() => expect(number).toHaveValue('NORTH-26-0002'));
    expect(screen.queryByText(/already in use/i)).not.toBeInTheDocument();
  });

  it('announces proposal loading and explains a missing client segment without inventing a number', async () => {
    let reject!: (error: Error) => void;
    h.proposeNumber.mockReturnValue(new Promise<string>((_resolve, fail) => { reject = fail; }));
    const { onSubmit } = renderModal();
    await userEvent.type(screen.getByLabelText(/project name/i), 'Site Upgrade');
    await selectClient();
    expect(screen.getByText(/proposing/i, { selector: '[role="status"]' })).toHaveTextContent(/proposing/i);
    await waitFor(() => expect(reject).toBeTypeOf('function'));
    reject(new Error('project_number_client_segment_required'));
    expect(await screen.findByText(/selected company needs a client number segment/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/pmo project number/i)).toHaveValue('');
    expect(screen.getByRole('button', { name: /create project/i })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
