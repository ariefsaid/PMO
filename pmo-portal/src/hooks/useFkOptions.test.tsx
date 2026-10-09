import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ── The repository seam is mocked; the hooks are the unit under test. ──
const { repo } = vi.hoisted(() => ({
  repo: {
    company: { list: vi.fn(), listClients: vi.fn() },
    profile: { listProjectManagers: vi.fn() },
    project: { list: vi.fn() },
  },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: repo }));

let orgId: string | undefined = 'org-1';
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: orgId ? { id: 'u1', org_id: orgId } : null }),
}));

import {
  useVendorOptions,
  useProjectOptions,
  useClientCompanyOptions,
  useProjectManagerOptions,
  useInvoiceProjectOptions,
} from './useFkOptions';
import { I18nextProvider } from 'react-i18next';
import { financeTestI18n } from '@/pages/__tests__/financeI18nTestInstance';

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  orgId = 'org-1';
  Object.values(repo).forEach((r) => Object.values(r).forEach((fn) => fn.mockReset()));
});

describe('useVendorOptions — vendor FK picker', () => {
  it('maps vendor companies into stable ComboboxOptions (id→value, name→label)', async () => {
    repo.company.list.mockResolvedValue([
      { id: 'v1', name: 'Apex Supply', type: 'Vendor', archived_at: null },
      { id: 'v2', name: 'Bolt Co', type: 'Vendor', archived_at: null },
    ]);
    const { result } = renderHook(() => useVendorOptions(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(repo.company.list).toHaveBeenCalledWith({ type: 'Vendor' });
    expect(result.current.data).toEqual([
      { value: 'v1', label: 'Apex Supply', sub: 'Vendor' },
      { value: 'v2', label: 'Bolt Co', sub: 'Vendor' },
    ]);
  });

  it('is disabled (no fetch) until the org is known', () => {
    orgId = undefined;
    const { result } = renderHook(() => useVendorOptions(), { wrapper: wrapper() });
    expect(repo.company.list).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });
});

describe('useProjectOptions — project FK picker (archived-filtered)', () => {
  it('excludes archived projects and maps id→value, name→label, code→sub', async () => {
    repo.project.list.mockResolvedValue([
      { id: 'p1', name: 'HQ Fit-Out', code: 'PRJ-1', archived_at: null },
      { id: 'p2', name: 'Old Job', code: 'PRJ-2', archived_at: '2026-01-01T00:00:00Z' },
      { id: 'p3', name: 'No Code', code: null, archived_at: null },
    ]);
    const { result } = renderHook(() => useProjectOptions(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual([
      { value: 'p1', label: 'HQ Fit-Out', sub: 'PRJ-1' },
      { value: 'p3', label: 'No Code', sub: undefined },
    ]);
  });
});

describe('useClientCompanyOptions — client FK picker', () => {
  it('maps client companies into ComboboxOptions with a Client sub', async () => {
    repo.company.listClients.mockResolvedValue([
      { id: 'c1', name: 'Innovate Corp', type: 'Client', archived_at: null },
    ]);
    const { result } = renderHook(() => useClientCompanyOptions(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual([{ value: 'c1', label: 'Innovate Corp', sub: 'Client' }]);
  });
});

describe('useProjectManagerOptions — PM FK picker', () => {
  it('maps PM profiles into ComboboxOptions (id→value, full_name→label)', async () => {
    repo.profile.listProjectManagers.mockResolvedValue([
      { id: 'u1', full_name: 'Alice Manager', role: 'Project Manager' },
    ]);
    const { result } = renderHook(() => useProjectManagerOptions(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual([{ value: 'u1', label: 'Alice Manager' }]);
  });
});


it('company pickers prefer the short name and keep the legal name in searchable option text (references AC-NICK-001)', async () => {
  repo.company.listClients.mockResolvedValue([{ id: 'c1', name: 'Example Legal Company', short_name: 'Example', type: 'Client' }]);
  const { result } = renderHook(() => useClientCompanyOptions(), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.data).toBeDefined());
  expect(result.current.data).toEqual([{ value: 'c1', label: 'Example', sub: 'Example Legal Company' }]);
});

describe('useInvoiceProjectOptions — the sales-invoice project picker (#784)', () => {
  it('AC-NAR-001 carries each project\'s client and VAT setting, and flags archived ones', async () => {
    repo.project.list.mockResolvedValue([
      { id: 'p1', name: 'Alpha', code: 'A-1', client_id: 'c1', subject_to_vat: true, tax_rate: 12, archived_at: null },
      { id: 'p2', name: 'Beta', code: null, client_id: null, subject_to_vat: false, tax_rate: null, archived_at: '2026-01-01T00:00:00Z' },
    ]);
    const { result } = renderHook(() => useInvoiceProjectOptions(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual([
      { value: 'p1', label: 'Alpha', sub: 'A-1', clientId: 'c1', subjectToVat: true, taxRate: 12, archived: false },
      { value: 'p2', label: 'Beta', sub: undefined, clientId: null, subjectToVat: false, taxRate: null, archived: true },
    ]);
  });
});

describe('useClientCompanyOptions — translated "Client" sub (#784 M-6)', () => {
  it('NFR-NAR-006 the Client sub follows the UI language', async () => {
    repo.company.listClients.mockResolvedValue([{ id: 'c1', name: 'Acme Energy', type: 'Client', short_name: null }]);
    await financeTestI18n.changeLanguage('id');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useClientCompanyOptions(), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <I18nextProvider i18n={financeTestI18n}><QueryClientProvider client={qc}>{children}</QueryClientProvider></I18nextProvider>
      ),
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.[0].sub).toBe(financeTestI18n.t('companies.type.client'));
    expect(result.current.data?.[0].sub).not.toBe('Client');
    await financeTestI18n.changeLanguage('en');
  });
});
