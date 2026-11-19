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

const { uploadMock } = vi.hoisted(() => ({ uploadMock: vi.fn() }));
vi.mock('@/src/hooks/useIncidents', () => ({
  useAssigneeOptions: () => ({ data: [] }),
  useIncidentEvidenceMutations: () => ({ upload: { mutateAsync: uploadMock, isPending: false } }),
}));
vi.mock('@/src/hooks/useWorkOrders', () => ({ useProjectWorkOrders: () => ({ data: [] }) }));

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
  work_order_id: null, assignee_id: null, action: null, due_at: null, closed_at: null, closed_by: null, close_note: null, escalated_at: null, task_id: null,
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

describe('IncidentFormModal photos (#2521)', () => {
  const photo = () => new File(['x'], 'rail.jpg', { type: 'image/jpeg' });

  it('AC-SIL-012: a failed upload keeps the typed text and offers a retry that does not file the issue twice', async () => {
    const created = { ...baseRow, id: 'new1' };
    const onCreate = vi.fn().mockResolvedValue(created);
    const onCreated = vi.fn();
    const onError = vi.fn();
    uploadMock.mockRejectedValueOnce(new Error('network down')).mockResolvedValue({});
    render(
      <ToastProvider>
        <IncidentFormModal incident={null} onClose={vi.fn()} onCreate={onCreate} onCreated={onCreated} onUpdate={vi.fn()} onError={onError} />
      </ToastProvider>,
    );

    await userEvent.type(screen.getByLabelText(/^type/i), 'Spill');
    await userEvent.upload(screen.getByTestId('incident-photo-input'), photo());
    await userEvent.click(screen.getByRole('button', { name: /^file incident$/i }));

    // The upload failed: the record was saved once, nothing closed, the typed text is still there, a retry is offered.
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreated).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalled();
    expect(screen.getByLabelText(/^type/i)).toHaveValue('Spill');
    expect(screen.getByText(/photo could not be uploaded/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /retry photo upload/i }));
    expect(onCreate).toHaveBeenCalledTimes(1); // not filed again
    expect(uploadMock).toHaveBeenCalledTimes(2);
    expect(onCreated).toHaveBeenCalledWith(created, expect.objectContaining({ type: 'Spill' }));
  });

  it('AC-SIL-010: the photo input opens the phone camera', () => {
    renderModal(null);
    const input = screen.getByTestId('incident-photo-input');
    expect(input).toHaveAttribute('accept', 'image/*');
    expect(input).toHaveAttribute('capture');
  });
});
