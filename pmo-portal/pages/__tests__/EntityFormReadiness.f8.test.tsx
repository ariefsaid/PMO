import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';

/**
 * AC-IXD-FORM-F8 — EntityFormModal blank-submit readiness.
 * A create/edit modal must not silently submit with blank required fields:
 *   1. Submit is disabled while a required field is blank → no mutation fires.
 *   2. Filling all required fields enables submit → the mutation fires once.
 *   3. A submit attempt with a non-blank-but-invalid field surfaces the inline
 *      error AND moves focus to that field (error summary focus-management).
 *
 * Covered on the reference CRUD slice (Companies), ProjectFormModal, and
 * NewProcurementModal.
 */

vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => vi.fn() };
});

// ── Companies harness ────────────────────────────────────────────────────────
const { companiesState, createMut } = vi.hoisted(() => ({
  companiesState: {
    data: [{ id: 'c1', name: 'Cascade Port Authority', type: 'Client', archived_at: null }] as Array<Record<string, unknown>>,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  createMut: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
}));
vi.mock('@/src/hooks/useCompanies', () => ({
  useCompanies: () => companiesState,
  useCompanyMutations: () => ({
    create: createMut,
    update: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

// ── Project / procurement FK hooks ───────────────────────────────────────────
vi.mock('@/src/hooks/useProjects', () => ({
  useClientCompanies: () => ({ data: [{ id: 'co-1', name: 'Cascade Port Authority' }], isError: false }),
  useProjectManagers: () => ({ data: [{ id: 'pm-1', full_name: 'Pat Manager' }], isError: false }),
}));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useProjectOptions: () => ({ data: [{ value: 'proj-1', label: 'HQ Fit-Out' }] }),
  useVendorOptions: () => ({ data: [{ value: 'v1', label: 'Apex Supply', sub: 'Vendor' }] }),
}));

import Companies from '../Companies';
import ProjectFormModal from '../../components/ProjectFormModal';
import { NewProcurementModal } from '../procurement/NewProcurementModal';

const renderCompanies = () =>
  render(
    <ImpersonationProvider realRole="Admin">
      <MemoryRouter>
        <ToastProvider>
          <Companies />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

beforeEach(() => {
  createMut.mutateAsync.mockClear();
  companiesState.isPending = false;
  companiesState.isError = false;
});

describe('AC-IXD-FORM-F8: Companies create modal readiness', () => {
  it('AC-IXD-FORM-F8: a fresh create modal has submit DISABLED and submitting fires no mutation', async () => {
    const user = userEvent.setup();
    renderCompanies();
    await user.click(screen.getByRole('button', { name: /New company/i }));
    const submit = await screen.findByRole('button', { name: 'Create company' });
    expect(submit).toBeDisabled();
    // A disabled button cannot fire the create mutation.
    await user.click(submit);
    expect(createMut.mutateAsync).not.toHaveBeenCalled();
  });

  it('AC-IXD-FORM-F8: filling the required name ENABLES submit and fires the create mutation once', async () => {
    const user = userEvent.setup();
    renderCompanies();
    await user.click(screen.getByRole('button', { name: /New company/i }));
    const submit = await screen.findByRole('button', { name: 'Create company' });
    await user.type(screen.getByLabelText(/^Company name/), 'New Vendor Co');
    expect(submit).toBeEnabled();
    await user.click(submit);
    await waitFor(() => expect(createMut.mutateAsync).toHaveBeenCalledTimes(1));
    expect(createMut.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'New Vendor Co' }),
    );
  });
});

describe('AC-IXD-FORM-F8: ProjectFormModal (new project) readiness', () => {
  it('AC-IXD-FORM-F8: a fresh New-project modal is clean on open (no eager error banner) and submit is DISABLED until required fields are present', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <ToastProvider>
        <ProjectFormModal onClose={vi.fn()} onSubmit={onSubmit} onError={vi.fn()} />
      </ToastProvider>,
    );
    const submit = screen.getByRole('button', { name: 'Create project' });
    expect(submit).toBeDisabled();
    expect(screen.queryByText(/Fix \d+ field/i)).not.toBeInTheDocument();
    // Name alone is not enough — client is also required.
    await user.type(screen.getByLabelText(/^Project name/), 'Harborside Terminal');
    expect(submit).toBeDisabled();
  });

  it('AC-IXD-FORM-F8: a non-blank-but-invalid value field, on submit, surfaces the inline error and moves focus to it', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <ToastProvider>
        <ProjectFormModal onClose={vi.fn()} onSubmit={onSubmit} onError={vi.fn()} />
      </ToastProvider>,
    );
    // Fill the required fields so submit is enabled.
    await user.type(screen.getByLabelText(/^Project name/), 'Harborside Terminal');
    // Select the (only) client via the Combobox (trigger has role="combobox").
    await user.click(screen.getByRole('combobox', { name: /Client company/i }));
    await user.click(await screen.findByRole('option', { name: /Cascade Port Authority/i }));
    // Now enter an INVALID estimated value (non-blank, bad format).
    const valueInput = screen.getByLabelText('Estimated value');
    await user.type(valueInput, 'abc');
    const submit = screen.getByRole('button', { name: 'Create project' });
    expect(submit).toBeEnabled(); // required fields are present → not blocked by completeness
    await user.click(submit);
    // The mutation is blocked by the format error.
    expect(onSubmit).not.toHaveBeenCalled();
    // The inline error surfaces and focus moves to the offending field.
    await waitFor(() => expect(valueInput).toHaveFocus());
  });
});

describe('AC-IXD-FORM-F8: NewProcurementModal readiness', () => {
  it('AC-IXD-FORM-F8: a fresh New-procurement modal is clean on open (no eager error banner) and submit is DISABLED', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue({ id: 'pr-1' });
    render(
      <ToastProvider>
        <NewProcurementModal onClose={vi.fn()} onCreate={onCreate} onError={vi.fn()} onCreated={vi.fn()} />
      </ToastProvider>,
    );
    const submit = screen.getByRole('button', { name: 'Create request' });
    expect(submit).toBeDisabled();
    expect(screen.queryByText(/Fix \d+ field/i)).not.toBeInTheDocument();
    await user.click(submit);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('AC-IXD-FORM-F8: filling the required title ENABLES submit and fires onCreate once', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue({ id: 'pr-1' });
    const onCreated = vi.fn();
    render(
      <ToastProvider>
        <NewProcurementModal onClose={vi.fn()} onCreate={onCreate} onError={vi.fn()} onCreated={onCreated} />
      </ToastProvider>,
    );
    const submit = screen.getByRole('button', { name: 'Create request' });
    await user.type(screen.getByLabelText(/^Title/), 'Welding consumables');
    expect(submit).toBeEnabled();
    await user.click(submit);
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ title: 'Welding consumables' }));
  });
});
