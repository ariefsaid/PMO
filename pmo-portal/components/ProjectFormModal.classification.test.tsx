import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';
import { axe, toHaveNoViolations } from 'jest-axe';
expect.extend(toHaveNoViolations);
vi.mock('@/src/hooks/useOrgTaxDefault', () => ({ useOrgTaxDefault: () => undefined, useTaxTreatmentPreselect: () => undefined }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useCompanies', () => ({ useCompanies: () => ({ data: [], isError: false }) }));
vi.mock('@/src/hooks/useProjects', () => ({
  useClientCompanies: () => ({ data: [{ id: 'c1', name: 'Synthetic Client', type: 'Client' }], isError: false }),
  useProjectManagers: () => ({ data: [], isError: false }),
}));
vi.mock('@/src/hooks/useProjectClassificationOptions', () => ({ useProjectClassificationOptions: () => ({
  data: { serviceLines: ['Engineering'], sectors: ['Energy'] }, isPending: false, isError: false,
}) }));
vi.mock('@/src/hooks/useProjectNumberProposal', () => ({
  useProjectNumberProposal: () => ({ status: 'success', number: 'PMO-TEST-0001', error: null }),
}));
import ProjectFormModal from './ProjectFormModal';
afterEach(() => cleanup());
it('AC-TAG-002 project creation states all five optional classifications through existing form controls', async () => {
  const user = userEvent.setup(); const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(<ToastProvider><ProjectFormModal onClose={vi.fn()} onSubmit={onSubmit} onError={vi.fn()} /></ToastProvider>);
  await user.type(screen.getByLabelText(/^Project name/), 'Classified project');
  await user.click(screen.getByRole('combobox', { name: /Client company/ }));
  await user.click(await screen.findByRole('option', { name: /Synthetic Client/ }));
  await user.selectOptions(screen.getByLabelText('Service line'), 'Engineering');
  await user.selectOptions(screen.getByLabelText('Sector'), 'Energy');
  await user.type(screen.getByLabelText('Location'), 'West Java');
  await user.selectOptions(screen.getByLabelText('Award type'), 'tender');
  await user.selectOptions(screen.getByLabelText('Bidding entity'), 'consortium');
  await user.click(screen.getByRole('button', { name: 'Create project' }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
    service_line: 'Engineering', sector: 'Energy', location: 'West Java', award_type: 'tender', bidding_entity: 'consortium',
  })));
});
it('AC-TAG-002 header editing retains a retired org option and allows explicit clearing', async () => {
  const user = userEvent.setup(); const onSave = vi.fn().mockResolvedValue(undefined);
  const initial = { id: 'p1', name: 'Classified project', code: null, client_id: 'c1', project_manager_id: null,
    service_line: 'Retired practice', sector: 'Energy', location: 'West Java', award_type: 'tender', bidding_entity: 'consortium' };
  const { container } = render(<ToastProvider><ProjectFormModal mode="editHeader" initial={initial} onClose={vi.fn()} onSave={onSave} onError={vi.fn()} /></ToastProvider>);
  expect(screen.getByLabelText('Service line')).toHaveValue('Retired practice');
  expect(screen.getByLabelText('Location')).toHaveValue('West Java');
  await user.selectOptions(screen.getByLabelText('Sector'), '');
  await user.click(screen.getByRole('button', { name: 'Save project' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith('p1', expect.objectContaining({ service_line: 'Retired practice', sector: null })));
  expect(await axe(container)).toHaveNoViolations();
});
it('AC-TAG-002 a location over 140 characters is refused inline and not submitted', async () => {
  const user = userEvent.setup(); const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(<ToastProvider><ProjectFormModal onClose={vi.fn()} onSubmit={onSubmit} onError={vi.fn()} /></ToastProvider>);
  await user.type(screen.getByLabelText(/^Project name/), 'Long location');
  await user.click(screen.getByRole('combobox', { name: /Client company/ }));
  await user.click(await screen.findByRole('option', { name: /Synthetic Client/ }));
  await user.click(screen.getByLabelText('Location'));
  await user.paste('x'.repeat(141));
  await user.click(screen.getByRole('button', { name: 'Create project' }));
  expect(await screen.findByText('Use 140 characters or fewer.')).toBeVisible();
  expect(onSubmit).not.toHaveBeenCalled();
});
