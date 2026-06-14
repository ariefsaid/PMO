import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';

// The ⌘K index gates pipeline rows on the viewer's real role (A-8). This dedupe test
// exercises the canonical-route behaviour, so it renders under an authorized role.
const wrapAdmin = ({ children }: { children: React.ReactNode }) =>
  React.createElement(ImpersonationProvider, { realRole: 'Admin' as const, children });

/**
 * AC-IXD-PROJ-006 (Model B, ADR-0020): ⌘K indexes a pipeline record ONCE, and its row drills
 * to the ONE canonical detail route `/projects/:id` (never a second `/sales/:id` row).
 *
 * Under Model B the active projects cache no longer holds pre-win rows (listProjects is scoped
 * to on-hand ∪ internal), so the projects loop and the pipeline loop no longer both emit the
 * same record — the pipeline loop is the sole pre-win source — and the sales row's run() is
 * repointed to the canonical project route.
 */
const { state } = vi.hoisted(() => ({
  state: {
    projects: { data: undefined as unknown, isPending: false, isError: false },
    procurements: { data: undefined as unknown, isPending: false, isError: false },
    pipeline: { data: undefined as unknown, isPending: false, isError: false },
  },
}));

vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => state.projects }));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => state.procurements }));
vi.mock('@/src/hooks/useDashboard', () => ({ useSalesPipeline: () => state.pipeline }));
// CW-7: the index now reads master-data caches too; stub them empty for the dedupe scope.
vi.mock('@/src/hooks/useCompanies', () => ({
  useCompanies: () => ({ data: [], isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useContacts', () => ({
  useContacts: () => ({ data: [], isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useIncidents', () => ({
  useIncidents: () => ({ data: [], isPending: false, isError: false }),
}));

import { useRecordSearch } from '../useRecordSearch';

const navigate = vi.fn();

beforeEach(() => {
  navigate.mockClear();
  state.projects = { data: [], isPending: false, isError: false };
  state.procurements = { data: [], isPending: false, isError: false };
  state.pipeline = { data: { stages: [], projects: [] }, isPending: false, isError: false };
});

describe('useRecordSearch — pipeline record indexed once → canonical route (AC-IXD-PROJ-006)', () => {
  it('AC-IXD-PROJ-006: a pipeline record emits exactly ONE row whose run() navigates to /projects/:id', () => {
    // The active projects cache (on-hand ∪ internal) does NOT hold the pre-win deal; the
    // pipeline cache is its sole source.
    state.projects = { data: [], isPending: false, isError: false };
    state.pipeline = {
      data: { stages: [], projects: [{ id: 'd1', name: 'Harbour Tender' }] },
      isPending: false,
      isError: false,
    };
    const { result } = renderHook(() => useRecordSearch(navigate), { wrapper: wrapAdmin });

    const rows = result.current.records.filter((r) => r.title === 'Harbour Tender');
    // de-dupe invariant: one entity → exactly one ⌘K row
    expect(rows).toHaveLength(1);
    // canonical route: drilling the row opens /projects/:id, never /sales/:id
    rows[0].run();
    expect(navigate).toHaveBeenCalledWith('/projects/d1');
    expect(navigate).not.toHaveBeenCalledWith('/sales/d1');
  });

  it('AC-IXD-PROJ-006: a pipeline row carries the canonical sub-label "Project · Pipeline" + pipe icon', () => {
    state.pipeline = {
      data: { stages: [], projects: [{ id: 'd1', name: 'Harbour Tender' }] },
      isPending: false,
      isError: false,
    };
    const { result } = renderHook(() => useRecordSearch(navigate), { wrapper: wrapAdmin });
    const row = result.current.records.find((r) => r.title === 'Harbour Tender');
    expect(row?.sub).toBe('Project · Pipeline');
    expect(row?.icon).toBe('pipe');
  });
});
