import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';
import type { IncidentRow } from '@/src/lib/db/incidents';

// Project FK options back the optional project selector on the file/edit form.
const { projectOptions } = vi.hoisted(() => ({
  projectOptions: { data: [] as { value: string; label: string; sub?: string }[] },
}));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useProjectOptions: () => projectOptions,
}));

import { IncidentFormModal } from './IncidentFormModal';

const baseRow: IncidentRow = {
  id: 'i1',
  org_id: 'org-1',
  incident_date: '2026-03-15',
  type: 'Near Miss',
  severity: 'High',
  location: 'Site B',
  description: 'desc',
  status: 'Open',
  reported_by: 'u1',
  project_id: null,
  created_at: '2026-03-15T00:00:00Z',
};

const renderModal = (incident: IncidentRow | null, onCreate = vi.fn(), onUpdate = vi.fn()) =>
  render(
    <ToastProvider>
      <IncidentFormModal
        incident={incident}
        onClose={vi.fn()}
        onCreate={onCreate}
        onUpdate={onUpdate}
        onError={vi.fn()}
      />
    </ToastProvider>,
  );

beforeEach(() => {
  projectOptions.data = [
    { value: 'p1', label: 'Eastfield Phase 2', sub: 'PRJ-001' },
    { value: 'p2', label: 'Northgate Retrofit', sub: 'PRJ-002' },
  ];
});

describe('IncidentFormModal project selector', () => {
  it('AC-IN-PROJ-011: filing an incident with a selected project sends project_id', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    renderModal(null, onCreate);

    await userEvent.type(screen.getByLabelText(/^type/i), 'Spill');

    // Open the project combobox and pick a project.
    const projectField = screen.getByRole('combobox', { name: /project/i });
    await userEvent.click(projectField);
    const listbox = await screen.findByRole('listbox');
    await userEvent.click(within(listbox).getByText('Eastfield Phase 2'));

    await userEvent.click(screen.getByRole('button', { name: /file incident/i }));

    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ project_id: 'p1' }));
  });

  it('AC-IN-PROJ-011: an edit form pre-selects the linked project and can keep it on save', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    renderModal({ ...baseRow, project_id: 'p2' }, vi.fn(), onUpdate);

    // The linked project name is shown in the pre-filled combobox.
    expect(screen.getByText('Northgate Retrofit')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /save incident/i }));
    expect(onUpdate).toHaveBeenCalledWith('i1', expect.objectContaining({ project_id: 'p2' }));
  });
});
