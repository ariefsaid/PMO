/**
 * AC-RAM-002 (#688) — Administration › Credits owns its loading and recoverable-error states.
 * Matrix cells R4 × O1 and R4 × O3 (docs/specs/ris-admin-route-matrix.spec.md): nothing proved them.
 * A loading or failed balance must never render a balance figure, and a failure must be recoverable
 * in place.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';

const { getOrgBalance, grant } = vi.hoisted(() => ({
  getOrgBalance: vi.fn(),
  grant: vi.fn(),
}));

vi.mock('@/src/lib/repositories', () => ({
  repositories: { credits: { getOrgBalance, grant } },
}));

import AdministrationCredits from '../AdministrationCredits';

const renderSection = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ToastProvider>
          <AdministrationCredits isOperator={false} orgId="org-1" />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  getOrgBalance.mockReset();
  grant.mockReset();
});

describe('AdministrationCredits — loading and error states (AC-RAM-002)', () => {
  it('AC-RAM-002: while the balance loads, a busy skeleton shows and no balance figure is claimed', () => {
    getOrgBalance.mockReturnValue(new Promise(() => {}));
    renderSection();
    expect(screen.getByTestId('liststate-loading')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByTestId('org-credit-balance')).not.toBeInTheDocument();
  });

  it('AC-RAM-002: a failed balance read shows an error with Retry, and Retry re-reads to the balance', async () => {
    getOrgBalance.mockRejectedValueOnce(new Error('network down')).mockResolvedValueOnce(120);
    renderSection();

    expect(await screen.findByText("Couldn't load balance")).toBeInTheDocument();
    expect(screen.queryByTestId('org-credit-balance')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() =>
      expect(screen.getByTestId('org-credit-balance')).toHaveTextContent(/120\s*credits/i),
    );
    expect(getOrgBalance).toHaveBeenCalledTimes(2);
  });
});