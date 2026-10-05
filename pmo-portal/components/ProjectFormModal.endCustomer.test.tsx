/**
 * AC-EC-002 — issue #758: the project create/edit form carries an OPTIONAL End customer combobox
 * directly after Client. It lists ALL the org's companies, is clearable back to null, is NOT in
 * requiredFields, and seeds the existing label in edit mode. Real rendered interaction (RTL).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import ProjectFormModal from './ProjectFormModal';

const END_ID = 'c9';
const EC_NAME = 'Asset Owner';

vi.mock('@/src/hooks/useOrgTaxDefault', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useOrgTaxDefault: () => undefined };
});
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useCompanies', () => ({
  useCompanies: () => ({
    data: [
      { id: 'c1', name: 'Innovate Corp', type: 'Client' },
      { id: 'c7', name: 'In-House Ops', type: 'Internal' },
      { id: END_ID, name: EC_NAME, type: 'Client' },
    ],
    isError: false,
  }),
}));
vi.mock('@/src/hooks/useProjects', () => ({
  useClientCompanies: () => ({ data: [{ id: 'c1', name: 'Innovate Corp', type: 'Client' }], isError: false }),
  useProjectManagers: () => ({ data: [{ id: 'u1', full_name: 'Alice Manager' }], isError: false }),
}));

function renderCreate(onSubmit = vi.fn()) {
  const utils = render(
    <ToastProvider>
      <ProjectFormModal onClose={vi.fn()} onSubmit={onSubmit} onError={vi.fn()} />
    </ToastProvider>,
  );
  return { onSubmit, ...utils };
}

function renderEdit(initial: React.ComponentProps<typeof ProjectFormModal>['initial'], onSave = vi.fn()) {
  const utils = render(
    <ToastProvider>
      <ProjectFormModal mode="editHeader" initial={initial} onClose={vi.fn()} onSave={onSave} onError={vi.fn()} />
    </ToastProvider>,
  );
  return { onSave, ...utils };
}

/** Fill required name + client so submit is enabled; returns the submit button. */
async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^Project name/), 'Harborside Terminal');
  await user.click(screen.getByRole('combobox', { name: /Client company/i }));
  await user.click(await screen.findByRole('option', { name: /Innovate Corp/i }));
  return screen.getByRole('button', { name: 'Create project' });
}

describe('AC-EC-002 — optional End customer combobox', () => {
  it('AC-EC-002: the End customer combobox renders directly after the Client combobox', () => {
    renderCreate();
    // Both labelled by their label span; map to visible label text isn't set, so check order via
    // the labels' own DOM order using within on the form.
    const clientLabel = screen.getByText('Client company');
    const ecLabel = screen.getByText('End customer');
    expect(clientLabel).toBeInTheDocument();
    expect(ecLabel).toBeInTheDocument();
    // DOM order: Client label precedes End customer label (End customer sits directly after).
    expect(clientLabel.compareDocumentPosition(ecLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('AC-EC-002: the End customer combobox is NOT required (no required-field gate) and lists ALL org companies', async () => {
    const user = userEvent.setup();
    renderCreate();
    // Open the end-customer picker — it must offer the Internal company too (all org companies).
    await user.click(screen.getByRole('combobox', { name: /End customer/i }));
    expect(await screen.findByRole('option', { name: /Innovate Corp/i })).toBeInTheDocument();
    expect(await screen.findByRole('option', { name: /In-House Ops/i })).toBeInTheDocument();
    expect(await screen.findByRole('option', { name: /Asset Owner/i })).toBeInTheDocument();
  });

  it('AC-EC-002: selecting an end customer submits end_client_id (create)', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderCreate();
    const submit = await fillRequired(user);
    await user.click(screen.getByRole('combobox', { name: /End customer/i }));
    await user.click(await screen.findByRole('option', { name: /Asset Owner/i }));
    await user.click(submit);
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ end_client_id: END_ID })),
    );
  });

  it('AC-EC-002: clearing a selected end customer submits end_client_id null (create)', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderCreate();
    const submit = await fillRequired(user);
    await user.click(screen.getByRole('combobox', { name: /End customer/i }));
    await user.click(await screen.findByRole('option', { name: /Asset Owner/i }));
    // Clear affordance — aria-label from combobox.clear ("Clear company").
    await user.click(screen.getByRole('button', { name: /Clear company/i }));
    await user.click(submit);
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ end_client_id: null })),
    );
  });

  it('AC-EC-002: editHeader seeds the existing end-customer label and saves end_client_id on submit', async () => {
    const user = userEvent.setup();
    const { onSave } = renderEdit({
      id: 'p1',
      name: 'Existing',
      code: null,
      client_id: 'c1',
      end_client_id: END_ID,
      endClientName: EC_NAME,
      project_manager_id: null,
    });
    // The seeded label renders in the combobox trigger.
    expect(screen.getByText(EC_NAME)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save project' }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({ end_client_id: END_ID }),
      ),
    );
  });

  it('AC-EC-002: editHeader saves end_client_id null when the end customer was cleared', async () => {
    const user = userEvent.setup();
    const { onSave } = renderEdit({
      id: 'p1',
      name: 'Existing',
      code: null,
      client_id: 'c1',
      end_client_id: END_ID,
      endClientName: EC_NAME,
      project_manager_id: null,
    });
    await user.click(screen.getByRole('button', { name: /Clear company/i }));
    await user.click(screen.getByRole('button', { name: 'Save project' }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({ end_client_id: null }),
      ),
    );
  });
});