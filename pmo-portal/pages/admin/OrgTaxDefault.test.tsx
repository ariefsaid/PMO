/**
 * `OD-TAX-1` / #548 — Administration › Default tax treatment.
 *
 * Two things are under test and they are not the same thing: that an Admin can move the org's
 * pre-selection, and that everyone ELSE sees the value without a control. `can('manage',
 * 'orgAccounting')` reads the REAL JWT role, mirroring migration 0207's Admin-only RLS policy
 * exactly — the FE may be stricter than RLS, never looser, and this gate is UX while RLS is the
 * authority (ADR-0016).
 *
 * Mirrors BudgetAccountMap.test.tsx's idiom: react-query + the repository seam mocked directly,
 * `usePermission` driven through the mocked `useEffectiveRole`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';

const { getTaxDefault, setTaxDefault } = vi.hoisted(() => ({
  getTaxDefault: vi.fn(),
  setTaxDefault: vi.fn(),
}));

vi.mock('@/src/lib/repositories', () => ({
  repositories: { orgSettings: { getTaxDefault, setTaxDefault } },
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }),
}));

let realRole: Role = 'Admin';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole, effectiveRole: realRole }),
}));

import OrgTaxDefault from './OrgTaxDefault';

const renderPanel = (role: Role = 'Admin') => {
  realRole = role;
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <OrgTaxDefault />
      </ToastProvider>
    </QueryClientProvider>,
  );
};

const select = () => screen.getByTestId('org-tax-default-select') as HTMLSelectElement;

beforeEach(() => {
  getTaxDefault.mockReset().mockResolvedValue('exclusive');
  setTaxDefault.mockReset().mockResolvedValue(undefined);
});

describe('OrgTaxDefault — the org-wide pre-selection (OD-TAX-1, migration 0207)', () => {
  it('#548: an Admin sees the current default in an editable control', async () => {
    renderPanel('Admin');
    await waitFor(() => expect(select().value).toBe('exclusive'));
    expect(select()).toBeEnabled();
  });

  it('#548: the control shows what the ORG holds — an inclusive org reads inclusive', async () => {
    getTaxDefault.mockResolvedValue('inclusive');
    renderPanel('Admin');
    await waitFor(() => expect(select().value).toBe('inclusive'));
  });

  it('#548: changing it writes through the repository seam', async () => {
    renderPanel('Admin');
    await waitFor(() => expect(select().value).toBe('exclusive'));
    await userEvent.selectOptions(select(), 'inclusive');
    await waitFor(() => expect(setTaxDefault).toHaveBeenCalledWith('inclusive'));
  });

  it('#548: a failed write surfaces a classified warning rather than a silent no-op', async () => {
    setTaxDefault.mockRejectedValue(Object.assign(new Error('denied'), { code: '42501' }));
    renderPanel('Admin');
    await waitFor(() => expect(select().value).toBe('exclusive'));
    await userEvent.selectOptions(select(), 'inclusive');
    await waitFor(() => expect(setTaxDefault).toHaveBeenCalled());
    expect(await screen.findByText(/permission|not allowed|access/i)).toBeInTheDocument();
  });

  it.each<Role>(['Project Manager', 'Finance', 'Executive', 'Engineer'])(
    '#548: %s sees the value but NO control — an accounting posture is an Admin decision',
    async (role) => {
      renderPanel(role);
      expect(await screen.findByTestId('org-tax-default-readonly')).toBeInTheDocument();
      expect(screen.queryByTestId('org-tax-default-select')).not.toBeInTheDocument();
      expect(setTaxDefault).not.toHaveBeenCalled();
    },
  );

  it('#548: the panel states, before anyone changes it, that existing records are untouched', async () => {
    // The single most important sentence on this screen: the setting pre-selects, it does not
    // restate history. An Admin who believes otherwise flips it expecting old figures to move.
    renderPanel('Admin');
    expect(
      await screen.findByText(/does not restate any existing figure/i),
    ).toBeInTheDocument();
  });
});
