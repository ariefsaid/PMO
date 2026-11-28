import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ── The repository seam is mocked; the hooks are the unit under test. ──
const { repo } = vi.hoisted(() => ({
  repo: {
    company: { listOptions: vi.fn() },
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
  useInvoiceProjectOptions,
} from './useFkOptions';

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
    repo.company.listOptions.mockResolvedValue([
      { id: 'v1', name: 'Apex Supply', type: 'Vendor', archived_at: null },
      { id: 'v2', name: 'Bolt Co', type: 'Vendor', archived_at: null },
    ]);
    const { result } = renderHook(() => useVendorOptions(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(repo.company.listOptions).toHaveBeenCalledWith();
    expect(result.current.data).toEqual([
      { value: 'v1', label: 'Apex Supply' },
      { value: 'v2', label: 'Bolt Co' },
    ]);
  });

  it('is disabled (no fetch) until the org is known', () => {
    orgId = undefined;
    const { result } = renderHook(() => useVendorOptions(), { wrapper: wrapper() });
    expect(repo.company.listOptions).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });

  // Every option of the supplier picker is a supplier, so no type tag rides on the row; only a short-name
  // company carries a sub (its legal name, AC-NICK-001).
  it('adds no type tag to supplier options and keeps the legal name of a short-name company as its sub', async () => {
    repo.company.listOptions.mockResolvedValue([
      { id: 'v1', name: 'Apex Supply', type: 'Vendor', archived_at: null, short_name: null },
      { id: 'v2', name: 'Bolt Co', type: 'Vendor', archived_at: null, short_name: 'Bolt' },
    ]);
    const { result } = renderHook(() => useVendorOptions(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual([
      { value: 'v1', label: 'Apex Supply' },
      { value: 'v2', label: 'Bolt', sub: 'Bolt Co' },
    ]);
  });
});

describe('useProjectOptions — project FK picker (archived-filtered)', () => {
  it('AC-002 #1325 shows the alias first, keeps legal name and code searchable, and excludes archived rows', async () => {
    repo.project.list.mockResolvedValue([
      { id: 'p-alias', name: 'Contractual North Terminal', short_name: 'North Terminal', code: 'PRJ-1', archived_at: null },
      { id: 'p2', name: 'Old Job', short_name: 'Old Alias', code: 'PRJ-2', archived_at: '2026-01-01T00:00:00Z' },
      { id: 'p3', name: 'No Code', short_name: null, code: null, archived_at: null },
    ]);
    const { result } = renderHook(() => useProjectOptions(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual([
      { value: 'p-alias', label: 'North Terminal', sub: 'Contractual North Terminal · PRJ-1' },
      { value: 'p3', label: 'No Code', sub: undefined },
    ]);
    expect(result.current.data?.map((option) => option.value)).toEqual(['p-alias', 'p3']);
  });

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
  it('maps client companies into ComboboxOptions with no type tag', async () => {
    repo.company.listOptions.mockResolvedValue([
      { id: 'c1', name: 'Innovate Corp', type: 'Client', archived_at: null },
    ]);
    const { result } = renderHook(() => useClientCompanyOptions(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual([{ value: 'c1', label: 'Innovate Corp' }]);
  });
});


it('company pickers prefer the short name and keep the legal name in searchable option text (references AC-NICK-001)', async () => {
  repo.company.listOptions.mockResolvedValue([{ id: 'c1', name: 'Example Legal Company', short_name: 'Example', type: 'Client' }]);
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
      { value: 'p1', label: 'Alpha', sub: 'A-1', contractualName: 'Alpha', clientId: 'c1', subjectToVat: true, taxRate: 12, archived: false },
      { value: 'p2', label: 'Beta', sub: undefined, contractualName: 'Beta', clientId: null, subjectToVat: false, taxRate: null, archived: true },
    ]);
  });

  it('AC-002 #1325 keeps invoice selector display separate from its contractual document identity', async () => {
    repo.project.list.mockResolvedValue([{
      id: 'p-contract', name: 'Contractual Terminal Expansion', short_name: 'Terminal North', code: 'CLIENT-8',
      client_id: 'c1', subject_to_vat: true, tax_rate: 12, archived_at: null,
    }]);
    const { result } = renderHook(() => useInvoiceProjectOptions(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual([{
      value: 'p-contract', label: 'Terminal North', sub: 'Contractual Terminal Expansion · CLIENT-8',
      contractualName: 'Contractual Terminal Expansion', clientId: 'c1', subjectToVat: true,
      taxRate: 12, archived: false,
    }]);
  });

  it('AC-S15-002 carries project currency and the stored tax-base fraction without recomputing either', async () => {
    repo.project.list.mockResolvedValue([
      {
        id: 'p-source', name: 'Source-currency project', code: null, client_id: 'c1',
        subject_to_vat: true, tax_rate: 12, currency: 'EUR',
        tax_base_numerator: 11, tax_base_denominator: 12, archived_at: null,
      },
    ]);
    const { result } = renderHook(() => useInvoiceProjectOptions(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual([
      {
        value: 'p-source', label: 'Source-currency project', sub: undefined, contractualName: 'Source-currency project',
        clientId: 'c1', subjectToVat: true, taxRate: 12, archived: false,
        currency: 'EUR', taxBaseNumerator: 11, taxBaseDenominator: 12,
      },
    ]);
  });
});

describe('project option hooks share one project read', () => {
  it('useProjects, useProjectOptions and useInvoiceProjectOptions fetch the project list once', async () => {
    repo.project.list.mockReset().mockResolvedValue([
      { id: 'p1', name: 'Alpha', code: 'A-1', client_id: 'c1', archived_at: null, subject_to_vat: false, tax_rate: null },
    ]);
    const { useProjects } = await import('./useProjects');
    const { result } = renderHook(() => ({ all: useProjects(), options: useProjectOptions(), invoice: useInvoiceProjectOptions() }), { wrapper: wrapper() });
    await waitFor(() => {
      expect(result.current.all.isSuccess && result.current.options.isSuccess && result.current.invoice.isSuccess).toBe(true);
    });
    expect(repo.project.list).toHaveBeenCalledTimes(1);
    expect(result.current.options.data).toHaveLength(1);
    expect(result.current.invoice.data?.[0]).toMatchObject({ value: 'p1', clientId: 'c1' });
  });
});
