/**
 * #693 (F-1) — the tax-default panel already translated its prose, but its SELECT options came from
 * the English-only `TAX_TREATMENT_OPTIONS` constant, so an Admin working in Bahasa chose between two
 * English sentences. Rendered under the real `id` catalogue the options must read as Bahasa.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
import { BahasaProvider } from '@/test/bahasa';

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

const renderPanel = () =>
  render(
    <BahasaProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <OrgTaxDefault />
        </ToastProvider>
      </QueryClientProvider>
    </BahasaProvider>,
  );

beforeEach(() => {
  realRole = 'Admin';
  getTaxDefault.mockReset().mockResolvedValue('exclusive');
  setTaxDefault.mockReset().mockResolvedValue(undefined);
});

describe('OrgTaxDefault in Bahasa (#693 F-1)', () => {
  it('#693: the Admin select offers Bahasa option labels', async () => {
    renderPanel();
    expect(await screen.findByRole('option', { name: 'Inclusive — jumlahnya sudah termasuk pajak' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Exclusive — pajak ditambahkan di atas jumlahnya' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /the amount already includes tax/ })).toBeNull();
  });
});
