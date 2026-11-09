import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { BahasaProvider } from '@/test/bahasa';

// #1339: the ⌘K code line named the identifiers in English whatever the viewer's language.
vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => ({ data: [{ id: 'p1', name: 'Site', pmo_project_number: 'PMO-26-7711', code: 'CLIENT-81' }], isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useDashboard', () => ({
  useSalesPipeline: () => ({
    data: { stages: [], projects: [{ id: 'o1', name: 'Bid', pmo_project_number: 'PMO-26-7712', code: 'CLIENT-82' }] },
    isPending: false, isError: false,
  }),
}));
vi.mock('@/src/hooks/useCompanies', () => ({ useCompanies: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useContacts', () => ({ useContacts: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useIncidents', () => ({ useIncidents: () => ({ data: [], isPending: false, isError: false }) }));

import { useLiveRecordSearch } from '../useRecordSearchData';

const wrap = ({ children }: { children: React.ReactNode }) => (
  <BahasaProvider><ImpersonationProvider realRole="Admin">{children}</ImpersonationProvider></BahasaProvider>
);

describe('useLiveRecordSearch code line in Bahasa (#1339)', () => {
  it('names the PMO and client identifiers in Indonesian for project and pipeline rows', () => {
    const { result } = renderHook(() => useLiveRecordSearch(vi.fn()), { wrapper: wrap });
    const project = result.current.records.find((r) => r.id.includes('p1'))!;
    const pipeline = result.current.records.find((r) => r.id.includes('o1'))!;
    for (const [row, pmo, client] of [[project, 'PMO-26-7711', 'CLIENT-81'], [pipeline, 'PMO-26-7712', 'CLIENT-82']] as const) {
      expect(row.code).toContain(`Nomor Proyek PMO: ${pmo}`);
      expect(row.code).toContain(`Kode Proyek Klien: ${client}`);
      expect(row.code).not.toContain('Client Project Code');
    }
  });
});
