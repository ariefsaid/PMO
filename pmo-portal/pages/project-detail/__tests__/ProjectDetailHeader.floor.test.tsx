import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, within, act } from '@testing-library/react';
import { toast as sonnerToast } from 'sonner';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { findToastAnnouncement } from '@/src/components/ui/__tests__/toastTestQueries';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';
import { renderWithQueryClient } from '@/test/renderWithQueryClient';
import ProjectDetailHeader from '../ProjectDetailHeader';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

// The toast library's store replays still-active toasts into the next provider — clear them.
afterEach(() => {
  act(() => { sonnerToast.dismiss(); });
});

// Same mock set as ProjectDetailHeader.test.tsx (the page's harness), trimmed to the
// floor rows under test: header menu + compact details popover.
const { roleBox, desktopBox, transitionMutations } = vi.hoisted(() => ({
  roleBox: { value: 'Project Manager' },
  desktopBox: { value: true },
  transitionMutations: {
    mutateAsync: vi.fn(),
  },
}));
const orgTodayBox = vi.hoisted(() => ({ value: '2026-11-11' }));
vi.mock('@/src/hooks/useOrgToday', () => ({ useOrgToday: () => orgTodayBox.value }));
vi.mock('@/src/components/ui/useIsDesktop', () => ({ useIsDesktop: () => desktopBox.value }));
const { budgetBox } = vi.hoisted(() => ({ budgetBox: { data: 4_200_000 as number | undefined, isPending: false, isError: false } }));
const { financeBox } = vi.hoisted(() => ({
  financeBox: {
    isPending: false,
    data: {
      actuals: {
        currency: 'USD', total: '1800000.00', excludes_restricted_rows: false,
        categories: [{ category: 'Labor', mapped: true, amount: '1800000.00' as string | null }],
      },
    },
  },
}));
vi.mock('@/src/hooks/useProjectFinances', () => ({ useProjectFinances: () => ({ ...financeBox, isError: false }) }));
vi.mock('@/src/hooks/useBudget', () => ({
  useProjectBudget: () => budgetBox,
}));
const { vatBox } = vi.hoisted(() => ({ vatBox: { data: { eligible: true, reason: null as string | null, hasInvoices: false }, isPending: false, isFetching: false, isError: false, refetch: vi.fn() } }));
vi.mock('@/src/hooks/useProjectVatEditability', () => ({ useProjectVatEditability: () => vatBox }));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjectMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    updateHeader: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    setContractValue: { mutateAsync: vi.fn(), isPending: false },
  }),
  useClientCompanies: () => ({ data: [{ id: 'c2', name: 'Innovate Corp', type: 'Client' }] }),
  useProjectManagers: () => ({ data: [{ id: 'u-alice', full_name: 'Alice Manager' }] }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-alice', org_id: 'org-1' }, role: roleBox.value }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: roleBox.value, realRole: roleBox.value, canImpersonate: false, viewAs: vi.fn() }),
}));
// The delivery-status write behind the compact popover's ProjectStatusControl.
vi.mock('@/src/hooks/useProjectTransitions', () => ({
  useProjectTransition: () => ({
    mutate: vi.fn(),
    mutateAsync: transitionMutations.mutateAsync,
    isError: false,
    error: null,
    isPending: false,
    erpSetupPending: false,
  }),
  useProjectWinEligibility: () => ({ data: undefined, isPending: false, isFetching: false, isError: false }),
}));

const onHand = {
  id: 'p1',
  name: 'Innovate Corp HQ Fit-Out',
  code: 'CLIENT-81',
  pmo_project_number: 'PMO-26-7711',
  status: 'Ongoing Project',
  client_id: 'c2',
  project_manager_id: 'u-alice',
  tax_treatment: 'exclusive',
  tax_amount: 550000,
  contract_value: 5000000,
  currency: 'USD',
  budget: 4700000,
  spent: 2100000,
  start_date: '2026-01-01',
  end_date: '2026-12-18',
  contract_date: '2026-01-10',
  customer_contract_ref: 'CPO-2026-001',
  client: { name: 'Innovate Corp' },
  pm: { full_name: 'Alice Manager' },
} as unknown as ProjectWithRefs;

const renderCompactHeader = (role = 'Project Manager') => {
  roleBox.value = role;
  // QueryClient: the popover's ERP-link section reads react-query bindings.
  return renderWithQueryClient(
    <MemoryRouter>
      <ToastProvider>
        {/* menuContent is what makes the popover carry the delivery-status section (ProjectDetail.tsx supplies it). */}
        <ProjectDetailHeader project={onHand} compact menuContent={<div />} commitmentSource="not-tracked" ledgerBasis="erp" />
      </ToastProvider>
    </MemoryRouter>,
  );
};

beforeEach(() => {
  setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
  roleBox.value = 'Project Manager';
  desktopBox.value = true;
  transitionMutations.mutateAsync.mockReset();
  transitionMutations.mutateAsync.mockResolvedValue(undefined);
});
afterEach(() => resetActiveLocale());

describe('ProjectDetailHeader floor', () => {
  it('floor: Copy link writes the canonical project URL to the clipboard and confirms', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderCompactHeader();

    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Copy link' }));

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/projects/p1`);
    const toast = await findToastAnnouncement('status', /Project link copied/i);
    expect(toast).toHaveTextContent('Innovate Corp HQ Fit-Out');
  });

  it('floor: Change delivery status commits the chosen status only after its confirm', async () => {
    renderCompactHeader();

    await userEvent.click(screen.getByRole('button', { name: 'Project details' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Change status' }));
    // Nothing is written while only the target is chosen (confirm-before-write).
    await userEvent.click(await screen.findByRole('button', { name: 'Close Out' }));
    expect(transitionMutations.mutateAsync).not.toHaveBeenCalled();
    // The popover itself is a dialog; the confirm is the one carrying the transition copy.
    const confirmDialog = (await screen.findAllByRole('dialog'))
      .find((d) => within(d).queryByRole('button', { name: 'Move to Close Out' }))!;
    await userEvent.click(within(confirmDialog).getByRole('button', { name: 'Move to Close Out' }));

    await expect(transitionMutations.mutateAsync).toHaveBeenCalledWith({ id: 'p1', to: 'Close Out', opts: undefined });
    await findToastAnnouncement('status', /Moved to Close Out/i);
  });
});
