/**
 * AC-ENT-004 — org-Admin read-only Features list; Operator toggles (ops-admin-surface S6).
 *
 *   - A non-Operator org-Admin → features render as a read-only "Included in your plan"
 *     list with NO `role="switch"` controls (a status pill carries the state, not a control).
 *   - The Operator → real `<button role="switch" aria-checked>` toggles; clicking one calls
 *     the toggle path (`repositories.orgFeature.toggle`).
 *   - A `core_not_gated` rejection (errcode `P0001`) → a toast ("Core modules can't be disabled").
 *   - Core modules (projects/dashboard/approvals/administration) always render locked-on and are
 *     NOT toggleable by anyone.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

const { orgFeaturesState, isOperatorState, toggleMock, toastSpy, refetchMock } = vi.hoisted(() => ({
  // The own-org feature map returned by useOrgFeatures (the Features section's read source).
  orgFeaturesState: {
    value: { incidents: false, crm: true } as Record<string, boolean | undefined> | undefined,
    status: { isPending: false, isError: false, isFetching: false },
  },
  isOperatorState: { value: false },
  toggleMock: { fn: vi.fn() },
  toastSpy: { fn: vi.fn() },
  refetchMock: { fn: vi.fn() },
}));

vi.mock('@/src/hooks/useOrgFeatures', () => ({
  useOrgFeatures: () => ({ data: orgFeaturesState.value, ...orgFeaturesState.status, refetch: refetchMock.fn }),
}));
vi.mock('@/src/auth/useIsOperator', () => ({
  useIsOperator: () => isOperatorState.value,
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Admin' }),
}));
vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    orgFeature: {
      listOwn: vi.fn(),
      toggle: (args: unknown) => toggleMock.fn(args),
    },
  },
}));
vi.mock('@/src/components/ui', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/src/components/ui')>();
  return {
    ...real,
    // Spy the toast so the P0001 case can assert a toast fired.
    useToast: () => ({ toast: toastSpy.fn }),
  };
});

import AdministrationFeatures from '../AdministrationFeatures';

const makeQc = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

const renderSection = (props?: Partial<React.ComponentProps<typeof AdministrationFeatures>>) =>
  render(
    <QueryClientProvider client={makeQc()}>
      <ImpersonationProvider realRole="Admin">
        <MemoryRouter>
          <ToastProvider>
            <AdministrationFeatures isOperator={isOperatorState.value} orgId="org-1" {...props} />
          </ToastProvider>
        </MemoryRouter>
      </ImpersonationProvider>
    </QueryClientProvider>,
  );

beforeEach(() => {
  orgFeaturesState.value = { incidents: false, crm: true };
  orgFeaturesState.status = { isPending: false, isError: false, isFetching: false };
  isOperatorState.value = false;
  toggleMock.fn = vi.fn();
  toastSpy.fn = vi.fn();
  refetchMock.fn = vi.fn();
});

describe('AC-ENT-004 — Features section: org-Admin read-only, Operator toggles', () => {
  it('AC-ENT-004: a non-Operator org-Admin sees a read-only list with NO toggle controls', () => {
    isOperatorState.value = false;
    renderSection();
    // No switch controls for an org-Admin (state is shown as a pill, not a control).
    expect(screen.queryByRole('switch')).toBeNull();
    // The features are listed as text (label present).
    expect(screen.getByText(/incidents/i)).toBeInTheDocument();
    expect(screen.getByText(/crm/i)).toBeInTheDocument();
  });

  it('AC-ENT-004: the Operator sees real role="switch" toggles', () => {
    isOperatorState.value = true;
    renderSection();
    const switches = screen.getAllByRole('switch');
    expect(switches.length).toBeGreaterThan(0);
    // The incidents switch reflects its disabled state via aria-checked.
    const incidentsSwitch = switches.find((s) => /incidents/i.test(s.getAttribute('aria-label') ?? ''));
    expect(incidentsSwitch).toBeDefined();
    expect(incidentsSwitch).toHaveAttribute('aria-checked', 'false');
  });

  it('shows editable capabilities in localized name order with their consequence beside the switch', () => {
    isOperatorState.value = true;
    renderSection();
    const editableRows = screen.getAllByRole('switch').map((control) =>
      control.closest('li')?.textContent?.trim(),
    );

    expect(editableRows[0]).toMatch(/^CRM/);
    expect(editableRows[0]).toContain('Manage sales pipelines, companies and contacts');
    expect(editableRows[1]).toMatch(/^Import \/ Export/);
    expect(editableRows[2]).toMatch(/^Incidents/);
    expect(editableRows[3]).toMatch(/^Microsoft 365 integration/);
    expect(editableRows[4]).toMatch(/^Procurement/);
    expect(editableRows[5]).toMatch(/^Timesheets/);
  });

  it('keeps Preview and Always included entries in collapsed disclosures', () => {
    isOperatorState.value = true;
    renderSection();

    expect(screen.getByText('Preview').closest('details')).not.toHaveAttribute('open');
    expect(screen.getByText('Always included').closest('details')).not.toHaveAttribute('open');
    expect(screen.getByText('Agent Assistant').closest('details')).toBe(screen.getByText('Preview').closest('details'));
    expect(screen.getByText('Projects').closest('details')).toBe(screen.getByText('Always included').closest('details'));
  });

  it('does not present environment defaults as confirmed capability values while the read is pending', () => {
    isOperatorState.value = true;
    orgFeaturesState.value = undefined;
    orgFeaturesState.status.isPending = true;
    renderSection();

    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('offers retry when capability state fails before any confirmed values are available', () => {
    isOperatorState.value = true;
    orgFeaturesState.value = undefined;
    orgFeaturesState.status.isError = true;
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(refetchMock.fn).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('retains the last confirmed values and exposes a scoped retry after refresh failure', () => {
    isOperatorState.value = true;
    orgFeaturesState.value = { crm: true };
    orgFeaturesState.status.isError = true;
    renderSection();

    const crmSwitch = screen.getByRole('switch', { name: /crm/i });
    expect(crmSwitch).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/last confirmed settings are still shown/i)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /retry/i })).toHaveLength(1);
  });

  it('AC-ENT-004: clicking a toggle calls repositories.orgFeature.toggle with the new state', async () => {
    isOperatorState.value = true;
    toggleMock.fn = vi.fn().mockResolvedValue(undefined);
    renderSection();
    const switches = screen.getAllByRole('switch');
    const incidentsSwitch = switches.find((s) => /incidents/i.test(s.getAttribute('aria-label') ?? ''))!;
    // Currently off (false) → clicking flips it to on (true).
    fireEvent.click(incidentsSwitch);
    await waitFor(() => {
      expect(toggleMock.fn).toHaveBeenCalledWith({
        orgId: 'org-1',
        key: 'incidents',
        enabled: true,
      });
      expect(screen.getByRole('status')).toHaveTextContent('Saved');
    });
  });

  it('AC-ENT-004: a core_not_gated (P0001) rejection surfaces a toast', async () => {
    isOperatorState.value = true;
    const err = Object.assign(new Error('core_not_gated'), { code: 'P0001' });
    toggleMock.fn = vi.fn().mockRejectedValue(err);
    renderSection();
    const switches = screen.getAllByRole('switch');
    const crmSwitch = switches.find((s) => /crm/i.test(s.getAttribute('aria-label') ?? ''))!;
    fireEvent.click(crmSwitch);
    await waitFor(() => {
      expect(toastSpy.fn).toHaveBeenCalled();
    });
    const [headline] = toastSpy.fn.mock.calls[0];
    expect(String(headline).toLowerCase()).toMatch(/core/);
  });

  it('AC-ENT-004: core modules render always-on and are NOT toggleable (no switch for projects)', () => {
    isOperatorState.value = true;
    renderSection();
    const switches = screen.getAllByRole('switch');
    // No switch is labelled for a core module.
    const coreSwitch = switches.find((s) =>
      /projects|dashboard|approvals|administration/i.test(s.getAttribute('aria-label') ?? ''),
    );
    expect(coreSwitch).toBeUndefined();
    // Core module text renders as always-on.
    expect(screen.getByText(/projects/i)).toBeInTheDocument();
  });
});
