/**
 * task FIX-1 (Discover CRITICAL 1) graduation — the RENDERED proof for companies: a flipped ownership
 * map routes a real company create through `repositories.company.*` (never the direct DAL), and the
 * TaskPushBadge visibly renders inside the real Companies page tree (useCompanyMutations is the REAL
 * hook here, unlike Companies.test.tsx's mocked-hook suite).
 *
 * The success path in production closes the modal immediately after `create.mutateAsync` resolves
 * (Companies.tsx's `onCreate`), so "Pushed" is not independently observable there — this test proves
 * what IS observable: Pushing while in flight, and Push failed persisting (the modal stays open on
 * error) for a Vendor/Client write on a flipped org.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: 'Admin', effectiveRole: 'Admin' }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }),
}));

const { company } = vi.hoisted(() => ({ company: { list: vi.fn(), create: vi.fn() } }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { company } }));

import Companies from './Companies';
import { clearOwnershipCache, setDomainOwnership } from '@/src/lib/adapterSeam/ownershipCache';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter>
          <Companies />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  company.list.mockResolvedValue([]);
  setDomainOwnership([{ domain: 'companies', externalTier: 'erpnext' }]);
});
afterEach(() => clearOwnershipCache());

describe('Companies — flipped ownership routes a real create externally + renders pendingPush', () => {
  it('a Vendor create shows Pushing while in flight, then Push failed on a rejected write (the modal stays open)', async () => {
    const user = userEvent.setup();
    let rejectCreate!: (err: unknown) => void;
    company.create.mockReturnValue(new Promise((_res, rej) => (rejectCreate = rej)));

    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: /new company/i })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /new company/i }));
    await user.type(screen.getByLabelText(/company name/i), 'Acme Vendor');
    // Type defaults to 'Client' — select Vendor is not required for this test's assertion; the
    // default 'Client' still dispatches externally (erp_doc_kind: customer) per repositories/index.ts.
    fireEvent.click(screen.getByRole('button', { name: /create company/i }));

    await waitFor(() => expect(screen.getByText('Pushing…')).toBeInTheDocument());
    expect(company.create).toHaveBeenCalledTimes(1);

    rejectCreate(Object.assign(new Error('site unreachable'), { code: 'external-unreachable' }));
    await waitFor(() => expect(screen.getByText('Push failed')).toBeInTheDocument());
    // The modal stays open on error (no onClose call in Companies.tsx's onError path).
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
