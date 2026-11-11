import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import ProjectFormModal from './ProjectFormModal';

vi.mock('@/src/hooks/useProjectClassificationOptions', () => ({ useProjectClassificationOptions: () => ({ data: { serviceLines: [], sectors: [] }, isError: false }) }));
vi.mock('@/src/hooks/useProjectNumberProposal', () => ({ useProjectNumberProposal: () => ({ status: 'success', number: 'PMO-TEST-1325', error: null }) }));
vi.mock('@/src/hooks/useOrgTaxDefault', () => ({ useOrgTaxDefault: () => undefined, useTaxTreatmentPreselect: () => undefined }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useCompanies', () => ({ useCompanies: () => ({ data: [{ id: 'c1', name: 'Client Legal', type: 'Client' }], isError: false }) }));
vi.mock('@/src/hooks/useProjects', () => ({
  useClientCompanies: () => ({ data: [{ id: 'c1', name: 'Client Legal', type: 'Client' }], isError: false }),
  useProjectManagers: () => ({ data: [], isError: false }),
}));

function renderForm(props: Partial<React.ComponentProps<typeof ProjectFormModal>> = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<ProjectFormModal mode="create" onClose={vi.fn()} onError={vi.fn()} onSubmit={onSubmit} onSave={onSave} {...props} />);
  return { onSubmit, onSave };
}

async function chooseClient() {
  await userEvent.click(screen.getByRole('combobox', { name: 'Client company' }));
  await userEvent.click(await screen.findByRole('option', { name: /Client Legal/ }));
}

describe('ProjectFormModal short name (AC-001 #1325)', () => {
  it.each(['Leads', 'Internal Project'] as const)('creates an optional alias in the %s origin flow', async (status) => {
    const { onSubmit } = renderForm();
    await userEvent.type(screen.getByLabelText(/^Project name/), 'Contractual delivery');
    await userEvent.type(screen.getByLabelText('Short name (optional)'), '  Site North  ');
    await chooseClient();
    if (status !== 'Leads') await userEvent.selectOptions(screen.getByLabelText('Origination stage'), status);
    await userEvent.click(screen.getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: 'Contractual delivery', short_name: 'Site North', status })));
  });

  it('preloads, changes, and explicitly clears an existing alias on edit', async () => {
    const { onSave } = renderForm({
      mode: 'editHeader',
      initial: { id: 'p1', name: 'Contractual delivery', short_name: 'Old label', code: null, client_id: 'c1', project_manager_id: null },
    });
    const alias = screen.getByLabelText('Short name (optional)');
    expect(alias).toHaveValue('Old label');
    await userEvent.clear(alias);
    await userEvent.click(screen.getByRole('button', { name: 'Save project' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('p1', expect.objectContaining({ name: 'Contractual delivery', short_name: null })));
  });

  it('keeps the contractual name required even when an alias is present', async () => {
    renderForm({ initial: undefined });
    await userEvent.type(screen.getByLabelText('Short name (optional)'), 'Alias only');
    expect(screen.getByRole('button', { name: 'Create project' })).toBeDisabled();
    expect(screen.getByLabelText(/^Project name/)).toBeRequired();
  });

  it('shows a field error when the short name is already used in the organization, and clears it on edit', async () => {
    const onError = vi.fn();
    const onSubmit = vi.fn().mockRejectedValue(Object.assign(new Error('duplicate key value violates unique constraint "projects_org_short_name_uidx"'), { code: '23505' }));
    renderForm({ onSubmit, onError });
    await userEvent.type(screen.getByLabelText(/^Project name/), 'Contractual delivery');
    const alias = screen.getByLabelText('Short name (optional)');
    await userEvent.type(alias, 'Taken');
    await chooseClient();
    await userEvent.click(screen.getByRole('button', { name: 'Create project' }));
    expect(await screen.findAllByText('Another project already uses this short name')).not.toHaveLength(0);
    expect(alias).toHaveAccessibleDescription(/Another project already uses this short name/);
    expect(onError).toHaveBeenCalled();
    await userEvent.type(alias, 'x');
    expect(screen.queryByText('Another project already uses this short name')).toBeNull();
  });
});
