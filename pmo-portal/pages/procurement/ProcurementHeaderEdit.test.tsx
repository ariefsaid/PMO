import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const options = vi.hoisted(() => ({
  project: { data: [{ value: 'proj-1', label: 'North Terminal', sub: 'HQ Fit-Out' }], isError: false, isPending: false, refetch: vi.fn() },
  vendor: { data: [] as { value: string; label: string }[], isError: false, isPending: false, refetch: vi.fn() },
}));
vi.mock('@/src/hooks/useFkOptions', () => ({ useProjectOptions: () => options.project, useVendorOptions: () => options.vendor }));

import { ProcurementHeaderEdit } from './ProcurementHeaderEdit';

function renderEdit(props: Partial<React.ComponentProps<typeof ProcurementHeaderEdit>> = {}) {
  const onSave = props.onSave ?? vi.fn().mockResolvedValue(undefined);
  const onError = props.onError ?? vi.fn();
  const onClose = props.onClose ?? vi.fn();
  const node = () => (
    <ToastProvider>
      <ProcurementHeaderEdit
        title={props.title ?? 'Welding consumables'}
        projectId={props.projectId ?? 'proj-1'}
        projectName={props.projectName ?? 'HQ Fit-Out'}
        vendorId={props.vendorId ?? null}
        vendorName={props.vendorName ?? null}
        onSave={onSave}
        onError={onError}
        onClose={onClose}
      />
    </ToastProvider>
  );
  const view = render(node());
  return { onSave, onError, onClose, refresh: () => view.rerender(node()) };
}

beforeEach(() => { vi.clearAllMocks(); options.project.isError = false; options.vendor.isError = false; options.project.isPending = false; options.vendor.isPending = false; options.vendor.data = []; });

// CW-3a: the Edit affordance moved to the canonical RecordHeader action zone (it is owned
// by ProcurementDetails now); this panel is CONTROLLED — when mounted it renders the edit
// form directly. The goal-oracle (Save delegates the right patch; Save disabled on empty
// title; Save closes the panel) is unchanged.
describe('AC-PROC-002 ProcurementHeaderEdit (Draft-header inline edit)', () => {
  it.each(['project', 'vendor'] as const)('retries unavailable %s options in the picker', async (kind) => {
    options[kind].isError = true;
    const { refresh } = renderEdit();
    await userEvent.click(screen.getByRole('combobox', { name: kind === 'project' ? 'Project' : 'Supplier' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(options[kind].refetch).toHaveBeenCalled();
    options[kind].isError = false;
    if (kind === 'vendor') options.vendor.data = [{ value: 'supplier', label: 'Supplier One' }];
    refresh();
    expect(await screen.findByRole('option', { name: kind === 'project' ? /North Terminal/ : 'Supplier One' })).toBeInTheDocument();
  });
  it.each(['project', 'vendor'] as const)('shows pending %s options without claiming an empty list', async (kind) => {
    options[kind].isPending = true;
    renderEdit();
    await userEvent.click(screen.getByRole('combobox', { name: kind === 'project' ? 'Project' : 'Supplier' }));
    expect(await screen.findByTestId('combo-loading')).toBeInTheDocument();
    expect(screen.queryByText(/Nothing is available to select yet/)).not.toBeInTheDocument();
  });
  it('shows the empty supplier list only after a successful read', async () => {
    renderEdit();
    await userEvent.click(screen.getByRole('combobox', { name: 'Supplier' }));
    expect(await screen.findByText(/Nothing is available to select yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });
  it('AC-PROC-002: renders the edit form directly when mounted (opened from the header Edit action)', () => {
    renderEdit();
    expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save procurement/i })).toBeInTheDocument();
  });

  it('AC-002 #1325: the loaded selected project discloses its contractual title beside the alias', () => {
    renderEdit({ projectName: 'HQ Fit-Out' });
    const trigger = screen.getByRole('combobox', { name: 'Project' });
    expect(trigger).toHaveTextContent('North Terminal');
    expect(trigger).toHaveAttribute('title', 'North Terminal — HQ Fit-Out');
  });

  it('AC-PROC-002: edit + Save delegates the patch and closes the panel', async () => {
    const { onSave, onClose } = renderEdit();
    const title = screen.getByLabelText(/title/i);
    await userEvent.clear(title);
    await userEvent.type(title, 'Welding consumables Q3');
    await userEvent.click(screen.getByRole('button', { name: /save procurement/i }));
    expect(onSave).toHaveBeenCalledWith({
      title: 'Welding consumables Q3',
      projectId: 'proj-1',
      vendorId: null,
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('AC-PROC-002: Save is disabled when the title is cleared', async () => {
    renderEdit();
    await userEvent.clear(screen.getByLabelText(/title/i));
    expect(screen.getByRole('button', { name: /save procurement/i })).toBeDisabled();
  });

  it('AC-PROC-002: a blank title shows the required-title message from the Bahasa catalogue', async () => {
    const idProcurement = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/procurement.json'), 'utf8'));
    const i18n = i18next.createInstance();
    await i18n.init({
      lng: 'id',
      fallbackLng: 'id',
      ns: ['procurement'],
      defaultNS: 'procurement',
      resources: { id: { procurement: idProcurement } },
      interpolation: { escapeValue: false },
    });

    render(
      <I18nextProvider i18n={i18n}>
        <ToastProvider>
          <ProcurementHeaderEdit
            title="Welding consumables"
            projectId="proj-1"
            projectName="HQ Fit-Out"
            vendorId={null}
            vendorName={null}
            onSave={vi.fn().mockResolvedValue(undefined)}
            onError={vi.fn()}
            onClose={vi.fn()}
          />
        </ToastProvider>
      </I18nextProvider>,
    );

    const title = screen.getByLabelText(/title/i);
    await userEvent.clear(title);
    await userEvent.tab();

    expect(await screen.findByText('Judul pengadaan wajib diisi.')).toBeInTheDocument();
    expect(screen.queryByText('A procurement title is required.')).not.toBeInTheDocument();
  });

  it('AC-PROC-002: Cancel closes the panel', async () => {
    const { onClose } = renderEdit();
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('F2-16 keeps the classified save refusal in the edit panel and preserves the draft for retry', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('permission denied'), { code: '42501' }))
      .mockResolvedValueOnce(undefined);
    const onError = vi.fn();
    const onClose = vi.fn();
    renderEdit({ onSave, onError, onClose });

    const title = screen.getByLabelText(/title/i);
    await user.clear(title);
    await user.type(title, 'Welding consumables Q3');
    await user.click(screen.getByRole('button', { name: /save procurement/i }));

    const saveError = await screen.findByText("You don't have permission to do that.");
    expect(saveError.closest('[role="alert"]')).not.toBeNull();
    expect(title).toHaveValue('Welding consumables Q3');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /save procurement/i }));
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
