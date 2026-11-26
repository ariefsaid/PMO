import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { resetActiveLocale, setActiveLocale, setActiveOrgTimezone } from '@/src/lib/locale/activeLocale';
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
const { typeState } = vi.hoisted(() => ({ typeState: { data: [] as { id: string; label: string; archived_at: string | null }[] } }));
vi.mock('@/src/hooks/useIncidentTypes', () => ({ useIncidentTypes: () => typeState }));
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
  lost_time: false, root_cause: null, type_id: null,
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
  typeState.data = [{ id: 't1', label: 'Near Miss', archived_at: null }, { id: 't2', label: 'Spill', archived_at: null }, { id: 't3', label: 'Retired', archived_at: '2026-11-01T00:00:00Z' }];
  projectOptions.data = [
    { value: 'p1', label: 'Eastfield Phase 2', sub: 'PRJ-001' },
    { value: 'p2', label: 'Northgate Retrofit', sub: 'PRJ-002' },
  ];
});

describe('IncidentFormModal project selector', () => {
  it('uses the resolved timezone for the last minute of the chosen due day', async () => {
    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'America/Los_Angeles' });
    const onCreate = vi.fn().mockResolvedValue(baseRow);
    renderModal(null, onCreate);
    await userEvent.selectOptions(screen.getByLabelText(/^type/i), 'Spill');
    fireEvent.change(screen.getByLabelText(/fix by/i), { target: { value: '2050-01-01' } });
    await userEvent.click(screen.getByRole('button', { name: /file incident/i }));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ due_at: '2050-01-02T07:59:00.000Z' }));
  });

  it('edits the due day in the resolved timezone', () => {
    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'America/Los_Angeles' });
    renderModal({ ...baseRow, due_at: '2050-01-02T07:59:00.000Z' });
    expect(screen.getByLabelText(/fix by/i)).toHaveValue('1 Jan 2050');
  });

  it("#2914: a new incident's date starts on the organisation's day, not the browser's", () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-25T18:00:00Z') });  // 26 Nov in Jakarta, still 25 Nov elsewhere
    try {
      setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'America/New_York' });
      setActiveOrgTimezone('Asia/Jakarta');
      renderModal(null);
      expect(screen.getByLabelText(/^date/i)).toHaveValue('26 Nov 2026');
    } finally { vi.useRealTimers(); resetActiveLocale(); }
  });

  it('filing from a project register keeps that project on the new issue', async () => {
    const onCreate = vi.fn().mockResolvedValue(baseRow);
    render(<ToastProvider><IncidentFormModal incident={null} defaultProjectId="p1" onClose={vi.fn()} onCreate={onCreate} onUpdate={vi.fn()} onError={vi.fn()} /></ToastProvider>);
    await userEvent.selectOptions(screen.getByLabelText(/^type/i), 'Spill');
    await userEvent.click(screen.getByRole('button', { name: /file incident/i }));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ project_id: 'p1' }));
  });

  it('AC-IN-PROJ-011: filing an incident with a selected project sends project_id', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    renderModal(null, onCreate);

    await userEvent.selectOptions(screen.getByLabelText(/^type/i), 'Spill');

    // Open the project combobox and pick a project.
    const projectField = screen.getByRole('combobox', { name: /project/i });
    await userEvent.click(projectField);
    const listbox = await screen.findByRole('listbox');
    await userEvent.click(within(listbox).getByText('Eastfield Phase 2'));

    await userEvent.click(screen.getByRole('button', { name: /file incident/i }));

    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ project_id: 'p1' }));
  });

  it('clears the old work order when changing a project', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    renderModal({ ...baseRow, project_id: 'p1', work_order_id: 'wo1' }, vi.fn(), onUpdate);
    await userEvent.click(screen.getByRole('combobox', { name: /project/i }));
    await userEvent.click(within(await screen.findByRole('listbox')).getByText('Northgate Retrofit'));
    await userEvent.click(screen.getByRole('button', { name: /save incident/i }));
    expect(onUpdate).toHaveBeenCalledWith('i1', expect.objectContaining({ project_id: 'p2', work_order_id: null }));
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

    await userEvent.selectOptions(screen.getByLabelText(/^type/i), 'Spill');
    await userEvent.upload(screen.getByTestId('incident-photo-input'), photo());
    await userEvent.click(screen.getByRole('button', { name: /^file incident$/i }));

    // The upload failed: the record was saved once, nothing closed, the typed text is still there, a retry is offered.
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreated).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalled();
    expect(screen.getByLabelText(/^type/i)).toHaveValue('Spill');
    expect(screen.getByText(/photo could not be uploaded/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^type/i)).toBeDisabled();

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

describe('AC-ICM-011 issue type is a pick from the kept list', () => {
  it('offers only live types, with no free text', () => {
    renderModal(null);
    const select = screen.getByLabelText(/^type/i) as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect(Array.from(select.options).map((o) => o.text)).toEqual(['Choose a type', 'Near Miss', 'Spill']);
  });
  it('keeps submit disabled until a type is chosen', async () => {
    renderModal(null);
    expect(screen.getByRole('button', { name: /^file incident$/i })).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText(/^type/i), 'Spill');
    expect(screen.getByRole('button', { name: /^file incident$/i })).toBeEnabled();
  });
  it('an empty list says who adds types', () => {
    typeState.data = [];
    renderModal(null);
    expect(screen.getByText(/An Admin adds them in Administration/i)).toBeInTheDocument();
  });
  it('an issue whose type was archived since still shows it on edit', () => {
    renderModal({ ...baseRow, type: 'Retired' });
    expect(screen.getByLabelText(/^type/i)).toHaveValue('Retired');
  });
});
