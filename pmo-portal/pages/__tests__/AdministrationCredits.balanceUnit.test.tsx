/**
 * AC-CRE-UNIT-001 — the org-Credits balance readout carries its unit (ops-admin Discover round,
 * 2026-07-06 owner minor fix). A bare number ("737.5") is ambiguous; the readout must read
 * "737.5 credits" so the unit is unambiguous without relying on the "Org balance" label alone.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';

vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    credits: {
      getOrgBalance: vi.fn().mockResolvedValue(737.5),
      grant: vi.fn().mockResolvedValue(undefined),
    },
  },
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

describe('AdministrationCredits — balance unit (AC-CRE-UNIT-001)', () => {
  it('renders the balance with the "credits" unit, not a bare number', async () => {
    renderSection();
    await waitFor(() => {
      expect(screen.getByTestId('org-credit-balance')).toHaveTextContent(/737\.5\s*credits/i);
    });
  });
});
