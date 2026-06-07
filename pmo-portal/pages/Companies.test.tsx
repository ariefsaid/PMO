import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import { AppError } from '@/src/lib/appError';

// ── Repository-seam-backed hooks are mocked; the page is the unit under test. ──
const { listState, mutations } = vi.hoisted(() => ({
  listState: {
    data: [] as unknown[],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  mutations: {
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
  },
}));

vi.mock('@/src/hooks/useCompanies', () => ({
  useCompanies: () => listState,
  useCompanyMutations: () => mutations,
}));

// usePermission reads the REAL JWT role from the impersonation context.
let realRole: Role = 'Admin';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole, effectiveRole: realRole }),
}));

import Companies from './Companies';

const seed = [
  { id: 'c1', name: 'Cascade Port Authority', type: 'Client', org_id: 'org-1', archived_at: null, created_at: '2026-01-01T00:00:00Z' },
  { id: 'c2', name: 'Steelforge Fabrication', type: 'Vendor', org_id: 'org-1', archived_at: null, created_at: '2026-02-01T00:00:00Z' },
  { id: 'c3', name: 'Internal Holdings', type: 'Internal', org_id: 'org-1', archived_at: null, created_at: '2026-03-01T00:00:00Z' },
];

const renderPage = (role: Role = 'Admin') => {
  realRole = role;
  return render(
    <ToastProvider>
      <MemoryRouter>
        <Companies />
      </MemoryRouter>
    </ToastProvider>,
  );
};

beforeEach(() => {
  listState.data = seed;
  listState.isPending = false;
  listState.isError = false;
  listState.refetch.mockClear();
  Object.values(mutations).forEach((m) => {
    m.mutateAsync.mockReset();
    m.mutateAsync.mockResolvedValue(undefined);
    m.isPending = false;
  });
  realRole = 'Admin';
});

describe('Companies index — rows + filters (AC-CO-001)', () => {
  it('AC-CO-001: renders seeded company rows with name + type', () => {
    renderPage();
    expect(screen.getByText('Cascade Port Authority')).toBeInTheDocument();
    expect(screen.getByText('Steelforge Fabrication')).toBeInTheDocument();
    // type pill rendered
    expect(screen.getAllByText('Client').length).toBeGreaterThan(0);
  });

  it('AC-CO-001: the type filter narrows the visible rows', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /^Vendor$/ }));
    expect(screen.queryByText('Cascade Port Authority')).not.toBeInTheDocument();
    expect(screen.getByText('Steelforge Fabrication')).toBeInTheDocument();
  });

  it('AC-CO-001: search filters rows by name', async () => {
    renderPage();
    await userEvent.type(screen.getByLabelText(/Search companies/i), 'steel');
    expect(screen.queryByText('Cascade Port Authority')).not.toBeInTheDocument();
    expect(screen.getByText('Steelforge Fabrication')).toBeInTheDocument();
  });

  it('AC-CO-001: each company_type renders a DISTINCT tinted pill (Client/Vendor/Internal differentiated)', () => {
    renderPage();
    // The Type column pill is the closest pill ancestor of the type label inside its row.
    const pillBg = (label: string, rowName: string) => {
      const row = screen.getByText(rowName).closest('tr')!;
      return within(row).getByText(label).closest('span')!.className;
    };
    const client = pillBg('Client', 'Cascade Port Authority'); // blue (open)
    const vendor = pillBg('Vendor', 'Steelforge Fabrication'); // violet
    const internal = pillBg('Internal', 'Internal Holdings'); // green (won)
    expect(client).toContain('bg-primary/10');
    expect(vendor).toContain('bg-violet/12');
    expect(internal).toContain('bg-success/12');
    // Vendor and Internal are no longer the same grey neutral fill.
    expect(vendor).not.toContain('bg-secondary');
    expect(internal).not.toContain('bg-secondary');
    expect(vendor).not.toBe(internal);
  });
});

describe('Companies index — states', () => {
  it('AC-CO-001: loading skeleton while pending', () => {
    listState.isPending = true;
    renderPage();
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
  });

  it('AC-CO-001: error state with retry', async () => {
    listState.isError = true;
    renderPage();
    const retry = screen.getByRole('button', { name: /Retry/i });
    await userEvent.click(retry);
    expect(listState.refetch).toHaveBeenCalled();
  });

  it('AC-CO-001: empty state teaches with a gated New company action', () => {
    listState.data = [];
    renderPage('Admin');
    expect(screen.getByText(/No companies yet/i)).toBeInTheDocument();
  });
});

describe('Companies index — RBAC affordance gating (AC-CO-007)', () => {
  it('AC-CO-007: Admin sees New company + Edit + Archive + Delete', async () => {
    renderPage('Admin');
    expect(screen.getByRole('button', { name: /New company/i })).toBeInTheDocument();
    await userEvent.click(within(screen.getByText('Cascade Port Authority').closest('tr')!).getByRole('button', { name: /Row actions/i }));
    expect(screen.getByRole('menuitem', { name: /Edit/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Archive/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Delete/i })).toBeInTheDocument();
  });

  it('AC-CO-007: PM sees New company + Edit but NOT Archive or Delete', async () => {
    renderPage('Project Manager');
    expect(screen.getByRole('button', { name: /New company/i })).toBeInTheDocument();
    await userEvent.click(within(screen.getByText('Cascade Port Authority').closest('tr')!).getByRole('button', { name: /Row actions/i }));
    expect(screen.getByRole('menuitem', { name: /Edit/i })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Archive/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Delete/i })).not.toBeInTheDocument();
  });

  it('AC-CO-007: Finance sees New company + Edit (master data write set incl. Finance)', () => {
    renderPage('Finance');
    expect(screen.getByRole('button', { name: /New company/i })).toBeInTheDocument();
  });

  it('AC-CO-007: Engineer is read-only — no New company and no row action menu', () => {
    renderPage('Engineer');
    expect(screen.queryByRole('button', { name: /New company/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Row actions/i })).not.toBeInTheDocument();
  });
});

describe('Companies create / edit form (AC-CO-003 / AC-CO-004)', () => {
  it('AC-CO-003: New company opens the modal; required-name validation blocks submit', async () => {
    renderPage('Admin');
    await userEvent.click(screen.getByRole('button', { name: /New company/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // submit empty → validation error, mutation NOT called
    await userEvent.click(screen.getByRole('button', { name: /^Create company$/i }));
    expect((await screen.findAllByText(/name is required/i)).length).toBeGreaterThan(0);
    expect(mutations.create.mutateAsync).not.toHaveBeenCalled();
  });

  it('AC-CO-003: a valid create submits name + type to the mutation', async () => {
    renderPage('Admin');
    await userEvent.click(screen.getByRole('button', { name: /New company/i }));
    await userEvent.type(screen.getByLabelText(/Company name/i), 'Westvale Logistics');
    await userEvent.selectOptions(screen.getByLabelText(/^Type/i), 'Vendor');
    await userEvent.click(screen.getByRole('button', { name: /^Create company$/i }));
    await waitFor(() =>
      expect(mutations.create.mutateAsync).toHaveBeenCalledWith({ name: 'Westvale Logistics', type: 'Vendor' }),
    );
  });

  it('AC-CO-003: a create rejected by RLS (42501) surfaces a classified warning toast', async () => {
    mutations.create.mutateAsync.mockRejectedValue(new AppError('not permitted', '42501'));
    renderPage('Admin');
    await userEvent.click(screen.getByRole('button', { name: /New company/i }));
    await userEvent.type(screen.getByLabelText(/Company name/i), 'Blocked Co');
    await userEvent.click(screen.getByRole('button', { name: /^Create company$/i }));
    const toast = await screen.findByRole('status');
    expect(toast).toHaveTextContent(/don't have permission/i);
  });

  it('AC-CO-004: Edit pre-fills the row and submits an update', async () => {
    renderPage('Admin');
    await userEvent.click(within(screen.getByText('Cascade Port Authority').closest('tr')!).getByRole('button', { name: /Row actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Edit/i }));
    const nameInput = screen.getByLabelText(/Company name/i) as HTMLInputElement;
    expect(nameInput.value).toBe('Cascade Port Authority');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Cascade Port Co');
    await userEvent.click(screen.getByRole('button', { name: /^Save company$/i }));
    await waitFor(() =>
      expect(mutations.update.mutateAsync).toHaveBeenCalledWith({
        id: 'c1',
        input: { name: 'Cascade Port Co', type: 'Client' },
      }),
    );
  });
});

describe('Companies archive (AC-CO-005)', () => {
  it('AC-CO-005: Archive routes through a confirm and calls the mutation', async () => {
    renderPage('Admin');
    await userEvent.click(within(screen.getByText('Steelforge Fabrication').closest('tr')!).getByRole('button', { name: /Row actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Archive/i }));
    // confirm dialog appears; mutation not yet called
    expect(mutations.archive.mutateAsync).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /Archive company/i }));
    await waitFor(() => expect(mutations.archive.mutateAsync).toHaveBeenCalledWith('c2'));
  });
});

describe('Companies delete (AC-CO-006)', () => {
  it('AC-CO-006: Delete routes through a destructive confirm and calls the mutation', async () => {
    renderPage('Admin');
    await userEvent.click(within(screen.getByText('Steelforge Fabrication').closest('tr')!).getByRole('button', { name: /Row actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Delete/i }));
    await userEvent.click(screen.getByRole('button', { name: /Delete company/i }));
    await waitFor(() => expect(mutations.remove.mutateAsync).toHaveBeenCalledWith('c2'));
  });

  it('AC-CO-006: an in-use (23503) delete surfaces a warning toast advising Archive instead', async () => {
    mutations.remove.mutateAsync.mockRejectedValue(new AppError('foreign key violation', '23503'));
    renderPage('Admin');
    await userEvent.click(within(screen.getByText('Cascade Port Authority').closest('tr')!).getByRole('button', { name: /Row actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Delete/i }));
    await userEvent.click(screen.getByRole('button', { name: /Delete company/i }));
    // the in-use message is surfaced via a warning toast (centralized "Still in use" headline,
    // ADR-0017) advising Archive instead
    const toast = await screen.findByRole('status');
    expect(toast).toHaveTextContent(/Still in use/i);
    expect(toast).toHaveTextContent(/Archive it instead/i);
  });

  it('AC-CO-006: an in-use (23503) delete renders an inline GateNotice naming the company + an Archive-instead recovery path', async () => {
    mutations.remove.mutateAsync.mockRejectedValue(new AppError('foreign key violation', '23503'));
    renderPage('Admin');
    await userEvent.click(within(screen.getByText('Cascade Port Authority').closest('tr')!).getByRole('button', { name: /Row actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Delete/i }));
    await userEvent.click(screen.getByRole('button', { name: /Delete company/i }));
    // The inline GateNotice (block-delete-if-referenced) names the company and offers recovery.
    const gate = await screen.findByTestId('company-delete-gate');
    expect(gate).toHaveTextContent(/Cascade Port Authority/);
    expect(gate).toHaveTextContent(/referenced/i);
    // "Archive instead" opens the archive confirm for that same company (no second click needed).
    await userEvent.click(within(gate).getByRole('button', { name: /Archive instead/i }));
    expect(
      screen.getByRole('button', { name: /Archive company/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Archive Cascade Port Authority\?/i)).toBeInTheDocument();
    // Confirming the archive runs the archive mutation for that company.
    await userEvent.click(screen.getByRole('button', { name: /Archive company/i }));
    await waitFor(() => expect(mutations.archive.mutateAsync).toHaveBeenCalledWith('c1'));
  });
});
