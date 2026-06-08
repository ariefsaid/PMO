import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

// FK pickers read cached option hooks ("hooks own data fetching"); stub them so
// the modal needs no QueryClient and the project/vendor Comboboxes are populated.
vi.mock('@/src/hooks/useFkOptions', () => ({
  useProjectOptions: () => ({ data: [{ value: 'proj-1', label: 'HQ Fit-Out', sub: 'PRJ-1' }] }),
  useVendorOptions: () => ({ data: [{ value: 'v1', label: 'Apex Supply', sub: 'Vendor' }] }),
}));

import { NewProcurementModal } from './NewProcurementModal';

function renderModal(props: Partial<React.ComponentProps<typeof NewProcurementModal>> = {}) {
  const onCreate = props.onCreate ?? vi.fn().mockResolvedValue({ id: 'pc-new' });
  const onCreated = props.onCreated ?? vi.fn();
  const onError = props.onError ?? vi.fn();
  const onClose = props.onClose ?? vi.fn();
  render(
    <ToastProvider>
      <NewProcurementModal
        onClose={onClose}
        onCreate={onCreate}
        onCreated={onCreated}
        onError={onError}
      />
    </ToastProvider>,
  );
  return { onCreate, onCreated, onError, onClose };
}

beforeEach(() => vi.clearAllMocks());

describe('AC-PROC-001 NewProcurementModal (raise a purchase request)', () => {
  it('AC-PROC-001: renders a dialog with a required title field and a Create action', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText(/title/i)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /create request/i })).toBeInTheDocument();
  });

  it('AC-PROC-001: submitting with a title calls onCreate with the TRIMMED title then onCreated with the new id', async () => {
    const { onCreate, onCreated } = renderModal();
    await userEvent.type(screen.getByLabelText(/title/i), '  Welding consumables Q3  ');
    await userEvent.click(screen.getByRole('button', { name: /create request/i }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate).toHaveBeenCalledWith({
      title: 'Welding consumables Q3',
      projectId: null,
      vendorId: null,
    });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('pc-new'));
  });

  it('AC-PROC-001: passes the selected project FK through to onCreate', async () => {
    const onCreate = vi.fn().mockResolvedValue({ id: 'pc-new' });
    renderModal({ onCreate });
    await userEvent.type(screen.getByLabelText(/title/i), 'Cables');
    await userEvent.click(screen.getByRole('combobox', { name: /project/i }));
    await userEvent.click(await screen.findByRole('option', { name: /hq fit-out/i }));
    await userEvent.click(screen.getByRole('button', { name: /create request/i }));
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(onCreate.mock.calls[0][0]).toMatchObject({ title: 'Cables', projectId: 'proj-1' });
  });

  it('AC-PROC-001: an empty title blocks submit and shows an inline required error', async () => {
    const { onCreate, onCreated } = renderModal();
    await userEvent.click(screen.getByRole('button', { name: /create request/i }));
    expect(onCreate).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
    // The inline FieldError (role="alert") announces the requirement.
    expect(screen.getAllByText(/request title is required/i).length).toBeGreaterThan(0);
  });

  it('AC-PROC-001: a whitespace-only title is treated as empty and blocks submit', async () => {
    const { onCreate } = renderModal();
    await userEvent.type(screen.getByLabelText(/title/i), '    ');
    await userEvent.click(screen.getByRole('button', { name: /create request/i }));
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getAllByText(/request title is required/i).length).toBeGreaterThan(0);
  });

  it('AC-PROC-001: a create failure is routed to onError and does NOT call onCreated', async () => {
    const boom = new Error('insert failed');
    const onCreate = vi.fn().mockRejectedValue(boom);
    const { onCreated, onError } = renderModal({ onCreate });
    await userEvent.type(screen.getByLabelText(/title/i), 'Pumps');
    await userEvent.click(screen.getByRole('button', { name: /create request/i }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith(boom));
    expect(onCreated).not.toHaveBeenCalled();
  });
});
