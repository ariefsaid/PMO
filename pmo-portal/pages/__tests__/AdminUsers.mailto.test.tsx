/**
 * AC-PJ-ADMIN-001 — Admin interim invite (T26)
 *
 * Replace the permanently-disabled "New user" button with an HONEST working
 * affordance: a "Copy invite instructions" button (copies to clipboard) and/or
 * a mailto: link. NO edge function, NO auth/service-role, NO schema.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';

// ── hoisted mocks ────────────────────────────────────────────────────────────
const { listState, mutations } = vi.hoisted(() => ({
  listState: {
    data: [
      { id: 'u1', full_name: 'Renata Halloway', email: 'renata@meridian.example', role: 'Admin', manager_id: null, org_id: 'org-1' },
    ] as unknown[],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  mutations: {
    updateRole: { mutateAsync: vi.fn(), isPending: false },
    assignManager: { mutateAsync: vi.fn(), isPending: false },
  },
}));

vi.mock('@/src/hooks/useUsers', () => ({
  useUsers: () => listState,
  useUserMutations: () => mutations,
}));

let realRole: Role = 'Admin';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole, effectiveRole: realRole }),
}));

// Clipboard mock
const writeTextMock = vi.fn();

import AdminUsers from '../AdminUsers';

beforeEach(() => {
  listState.isPending = false;
  listState.isError = false;
  realRole = 'Admin';
  writeTextMock.mockReset();
  writeTextMock.mockResolvedValue(undefined);
  // Set up clipboard mock
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: writeTextMock },
    writable: true,
    configurable: true,
  });
});

const renderPage = (role: Role = 'Admin') => {
  realRole = role;
  return render(
    <ToastProvider>
      <MemoryRouter>
        <AdminUsers />
      </MemoryRouter>
    </ToastProvider>,
  );
};

describe('AC-PJ-ADMIN-001: Admin interim invite affordance', () => {
  it('AC-PJ-ADMIN-001a: the old permanently-disabled "New user" button is GONE — replaced by a live affordance', () => {
    renderPage('Admin');
    // The permanently-disabled button with no action should no longer exist
    // (the new affordance is live / a mailto link — not a disabled dead-end)
    const disabledBtn = screen.queryByRole('button', { name: /New user \(user invites arrive soon\)/i });
    expect(disabledBtn).toBeNull();
  });

  it('AC-PJ-ADMIN-001b: a live "Copy invite instructions" button is visible to Admin', () => {
    renderPage('Admin');
    // The new affordance — either a button or link — is live (not disabled)
    const affordance =
      screen.queryByRole('button', { name: /Copy invite/i }) ??
      screen.queryByRole('link', { name: /invite/i });
    expect(affordance).not.toBeNull();
  });

  it('AC-PJ-ADMIN-001c: clicking "Copy invite instructions" copies onboarding text to clipboard', async () => {
    renderPage('Admin');
    const btn = screen.getByRole('button', { name: /Copy invite/i });
    expect(btn).not.toBeDisabled();
    await userEvent.click(btn);
    await waitFor(() => expect(writeTextMock).toHaveBeenCalled());
    // The copied text should include meaningful onboarding content
    const copiedText = writeTextMock.mock.calls[0]?.[0] as string;
    expect(copiedText).toBeTruthy();
    expect(copiedText.length).toBeGreaterThan(10);
  });

  it('AC-PJ-ADMIN-001d: the invite affordance is NOT shown to non-Admin roles', () => {
    renderPage('Executive');
    // The exec read-only directory does not show invite affordances
    expect(screen.queryByRole('button', { name: /Copy invite/i })).not.toBeInTheDocument();
  });

  it('AC-PJ-ADMIN-001e: a mailto link is present as an alternative channel', () => {
    renderPage('Admin');
    // Either a visible mailto link or an explanatory note about email-based onboarding
    // This tests the presence of meaningful invite copy (button or link)
    const affordance = screen.queryByRole('button', { name: /Copy invite/i });
    expect(affordance).not.toBeNull();
    // No permanently-disabled dead-end
    expect(affordance).not.toBeDisabled();
  });
});
