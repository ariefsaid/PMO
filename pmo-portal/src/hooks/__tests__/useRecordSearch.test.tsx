import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';

// The ⌘K index gates procurement + pipeline rows on the viewer's real role (A-8,
// AC-W2-RBAC-015). These behaviour tests exercise the indexing itself, so they render
// under an authorized role (Admin sees every module's rows) — the gate's own two-sided
// proof lives in useRecordSearch.rbac.test.tsx.
const wrapAdmin = ({ children }: { children: React.ReactNode }) => (
  <ImpersonationProvider realRole="Admin">{children}</ImpersonationProvider>
);

// Mock the three cached list hooks the index reads. Each test sets the return
// value before rendering (vi.hoisted so the factory can close over the holder).
const { state } = vi.hoisted(() => ({
  state: {
    projects: { data: undefined, isPending: false, isError: false } as {
      data: unknown;
      isPending: boolean;
      isError: boolean;
    },
    procurements: { data: undefined, isPending: false, isError: false } as {
      data: unknown;
      isPending: boolean;
      isError: boolean;
    },
    pipeline: { data: undefined, isPending: false, isError: false } as {
      data: unknown;
      isPending: boolean;
      isError: boolean;
    },
  },
}));

// Companies + Contacts + Incidents cached-list holders (⌘K indexes master data — CW-7 +
// the incident register — CW-4a).
const { stateCC } = vi.hoisted(() => ({
  stateCC: {
    companies: { data: undefined, isPending: false, isError: false } as {
      data: unknown;
      isPending: boolean;
      isError: boolean;
    },
    contacts: { data: undefined, isPending: false, isError: false } as {
      data: unknown;
      isPending: boolean;
      isError: boolean;
    },
    incidents: { data: undefined, isPending: false, isError: false } as {
      data: unknown;
      isPending: boolean;
      isError: boolean;
    },
  },
}));

vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => state.projects }));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => state.procurements }));
vi.mock('@/src/hooks/useDashboard', () => ({ useSalesPipeline: () => state.pipeline }));
vi.mock('@/src/hooks/useCompanies', () => ({ useCompanies: () => stateCC.companies }));
vi.mock('@/src/hooks/useContacts', () => ({ useContacts: () => stateCC.contacts }));
vi.mock('@/src/hooks/useIncidents', () => ({ useIncidents: () => stateCC.incidents }));

import { useRecordSearch, rankRecords } from '../useRecordSearch';

const navigate = vi.fn();

beforeEach(() => {
  navigate.mockClear();
  state.projects = { data: undefined, isPending: false, isError: false };
  state.procurements = { data: undefined, isPending: false, isError: false };
  state.pipeline = { data: undefined, isPending: false, isError: false };
  stateCC.companies = { data: undefined, isPending: false, isError: false };
  stateCC.contacts = { data: undefined, isPending: false, isError: false };
  stateCC.incidents = { data: undefined, isPending: false, isError: false };
});

describe('useRecordSearch — index of the 3 cached lists', () => {
  // AC-CMDK-001: projects appear as Records rows with title + code + module sub-label.
  it('AC-CMDK-001: maps projects to Records rows with code, sub-label, and a run() → /projects/:id', () => {
    state.projects = {
      data: [{ id: 'p1', name: 'Harbour Expansion', code: 'PRJ-0142' }],
      isPending: false,
      isError: false,
    };
    const { result } = renderHook(() => useRecordSearch(navigate), { wrapper: wrapAdmin });
    const proj = result.current.records.find((r) => r.id.includes('p1'));
    expect(proj).toBeDefined();
    expect(proj!.group).toBe('Records');
    expect(proj!.title).toBe('Harbour Expansion');
    expect(proj!.code).toBe('PRJ-0142');
    expect(proj!.sub).toBe('Project');
    proj!.run();
    expect(navigate).toHaveBeenCalledWith('/projects/p1');
  });

  // Model B (ADR-0020): a pipeline record drills to the ONE canonical route /projects/:id
  // (was /sales/:id) — the deliberate UX change; the goal (open the record's detail page)
  // is preserved.
  it('indexes pipeline opportunities → /projects/:id and procurements → /procurement/:id', () => {
    state.pipeline = {
      data: { stages: [], projects: [{ id: 'o1', name: 'Acme Tender' }] },
      isPending: false,
      isError: false,
    };
    state.procurements = {
      data: [{ id: 'pr1', title: 'Crane hire', code: 'PROC-2026-002' }],
      isPending: false,
      isError: false,
    };
    const { result } = renderHook(() => useRecordSearch(navigate), { wrapper: wrapAdmin });

    const opp = result.current.records.find((r) => r.title === 'Acme Tender');
    expect(opp?.sub).toBe('Project · Pipeline');
    opp!.run();
    expect(navigate).toHaveBeenCalledWith('/projects/o1');

    const pr = result.current.records.find((r) => r.title === 'Crane hire');
    expect(pr?.sub).toBe('Procurement');
    expect(pr?.code).toBe('PROC-2026-002');
    pr!.run();
    expect(navigate).toHaveBeenCalledWith('/procurement/pr1');
  });

  // AC-CMDK-004: isPending passthrough while any list is still fetching.
  it('AC-CMDK-004: reports isPending when any cached list is still fetching', () => {
    state.projects = { data: undefined, isPending: true, isError: false };
    const { result } = renderHook(() => useRecordSearch(navigate), { wrapper: wrapAdmin });
    expect(result.current.isPending).toBe(true);
  });

  // AC-CMDK-005: isError passthrough when a list query failed.
  it('AC-CMDK-005: reports isError when a cached list query failed', () => {
    state.procurements = { data: undefined, isPending: false, isError: true };
    const { result } = renderHook(() => useRecordSearch(navigate), { wrapper: wrapAdmin });
    expect(result.current.isError).toBe(true);
  });

  // CW-7: ⌘K must index master data (Companies + Contacts), not just projects/procurement —
  // searching a company/contact name returned nothing before this fix.
  it('CW-7: indexes companies → /companies (deep-link to the record) with the right sub-label', () => {
    stateCC.companies = {
      data: [{ id: 'co1', name: 'Innovate Corp', type: 'Client' }],
      isPending: false,
      isError: false,
    };
    const { result } = renderHook(() => useRecordSearch(navigate), { wrapper: wrapAdmin });
    const co = result.current.records.find((r) => r.title === 'Innovate Corp');
    expect(co).toBeDefined();
    expect(co!.group).toBe('Records');
    expect(co!.sub).toBe('Company');
    co!.run();
    expect(navigate).toHaveBeenCalledWith('/companies?focus=co1');
  });

  it('CW-7: indexes contacts → /contacts (deep-link to the record) with the right sub-label', () => {
    stateCC.contacts = {
      data: [{ id: 'ct1', full_name: 'Dana Buyer', company_id: 'co1' }],
      isPending: false,
      isError: false,
    };
    const { result } = renderHook(() => useRecordSearch(navigate), { wrapper: wrapAdmin });
    const ct = result.current.records.find((r) => r.title === 'Dana Buyer');
    expect(ct).toBeDefined();
    expect(ct!.sub).toBe('Contact');
    ct!.run();
    expect(navigate).toHaveBeenCalledWith('/contacts?focus=ct1');
  });

  it('CW-4a: indexes incidents → /incidents/:id (its `type` is the title) with the right sub-label', () => {
    stateCC.incidents = {
      data: [{ id: 'in1', type: 'Near Miss', severity: 'Low', status: 'Open' }],
      isPending: false,
      isError: false,
    };
    const { result } = renderHook(() => useRecordSearch(navigate), { wrapper: wrapAdmin });
    const inc = result.current.records.find((r) => r.title === 'Near Miss');
    expect(inc).toBeDefined();
    expect(inc!.group).toBe('Records');
    expect(inc!.sub).toBe('Incident');
    inc!.run();
    expect(navigate).toHaveBeenCalledWith('/incidents/in1');
  });

  it('returns no records (empty index) when all lists are empty', () => {
    state.projects = { data: [], isPending: false, isError: false };
    state.procurements = { data: [], isPending: false, isError: false };
    state.pipeline = { data: { stages: [], projects: [] }, isPending: false, isError: false };
    stateCC.companies = { data: [], isPending: false, isError: false };
    stateCC.contacts = { data: [], isPending: false, isError: false };
    stateCC.incidents = { data: [], isPending: false, isError: false };
    const { result } = renderHook(() => useRecordSearch(navigate), { wrapper: wrapAdmin });
    expect(result.current.records).toHaveLength(0);
  });
});

describe('rankRecords — filter + exact-code-first + per-group cap', () => {
  const make = (id: string, title: string, code?: string) => ({
    id: `projects:${id}`,
    group: 'Records' as const,
    title,
    sub: 'Project',
    code,
    icon: 'folder' as const,
    run: vi.fn(),
  });

  it('substring-matches title and code (case-insensitive)', () => {
    const recs = [make('1', 'Harbour Expansion', 'PRJ-0142'), make('2', 'Bridge Repair', 'PRJ-0200')];
    const out = rankRecords(recs, 'harbour');
    expect(out.items.map((r) => r.title)).toEqual(['Harbour Expansion']);
  });

  // AC-CMDK-002: an exact code match ranks first.
  it('AC-CMDK-002: an exact code match ranks first', () => {
    const recs = [
      make('1', 'Alpha PROC related', 'PROC-2026-010'),
      make('2', 'Beta', 'PROC-2026-002'),
      make('3', 'PROC mention in name', 'PRJ-1'),
    ];
    const out = rankRecords(recs, 'PROC-2026-002');
    expect(out.items[0].code).toBe('PROC-2026-002');
  });

  // AC-CMDK-006: per-group cap of 8 with an overflow count.
  it('AC-CMDK-006: caps at 8 rows and reports the overflow count', () => {
    const recs = Array.from({ length: 12 }, (_, i) => make(String(i), `Match ${i}`));
    const out = rankRecords(recs, 'match');
    expect(out.items).toHaveLength(8);
    expect(out.overflow).toBe(4);
  });

  it('reports zero overflow when at or under the cap', () => {
    const recs = Array.from({ length: 5 }, (_, i) => make(String(i), `Match ${i}`));
    const out = rankRecords(recs, 'match');
    expect(out.items).toHaveLength(5);
    expect(out.overflow).toBe(0);
  });

  it('empty query returns no records (records are shown only while searching)', () => {
    const recs = [make('1', 'Harbour')];
    expect(rankRecords(recs, '').items).toHaveLength(0);
  });
});
