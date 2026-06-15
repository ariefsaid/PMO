/**
 * Feature-flag gate tests for useRecordSearch — incidents indexing (interim UI flag).
 *
 * Proves two sides:
 *  - Flag off → incident entries are excluded from the index even when useIncidents returns rows.
 *  - Flag on  → incident entries ARE included (gate is the hiding mechanism).
 *
 * The useIncidents hook call is kept regardless (hooks can't be conditional); only
 * the push into the output array is gated.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';

const wrapAdmin = ({ children }: { children: React.ReactNode }) => (
  <ImpersonationProvider realRole="Admin">{children}</ImpersonationProvider>
);

// ── Stable mock state holders ─────────────────────────────────────────────────
// INCIDENT_ROW is inlined inside vi.hoisted to avoid TDZ (hoisted closures run
// before top-level const declarations are evaluated).
const { searchState, INCIDENT_ROW } = vi.hoisted(() => {
  const row = { id: 'in-flag-1', type: 'Near Miss', severity: 'Low', status: 'Open' };
  return {
    INCIDENT_ROW: row,
    searchState: {
      projects: { data: [] as unknown[], isPending: false, isError: false },
      procurements: { data: [] as unknown[], isPending: false, isError: false },
      pipeline: { data: { stages: [], projects: [] as unknown[] }, isPending: false, isError: false },
      companies: { data: [] as unknown[], isPending: false, isError: false },
      contacts: { data: [] as unknown[], isPending: false, isError: false },
      incidents: { data: [row] as unknown[], isPending: false, isError: false },
    },
  };
});

vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => searchState.projects }));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => searchState.procurements }));
vi.mock('@/src/hooks/useDashboard', () => ({ useSalesPipeline: () => searchState.pipeline }));
vi.mock('@/src/hooks/useCompanies', () => ({ useCompanies: () => searchState.companies }));
vi.mock('@/src/hooks/useContacts', () => ({ useContacts: () => searchState.contacts }));
vi.mock('@/src/hooks/useIncidents', () => ({ useIncidents: () => searchState.incidents }));

// ── Mock features (start with real defaults) ──────────────────────────────────
vi.mock('@/src/lib/features', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/src/lib/features')>();
  return { ...real };
});

import { useRecordSearch } from '../useRecordSearch';
import * as features from '@/src/lib/features';

const navigate = vi.fn();

describe('useRecordSearch — incidents feature-flag gate', () => {
  let spy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    spy?.mockRestore();
    navigate.mockClear();
  });

  // ── Flag OFF (current default) ─────────────────────────────────────────────

  it('flag-off: no incidents: entries in the record index even when useIncidents returns rows', () => {
    // isFeatureEnabled('incidents') is false by default (real FEATURES const)
    const { result } = renderHook(() => useRecordSearch(navigate), { wrapper: wrapAdmin });
    const incidentEntries = result.current.records.filter((r) => r.id.startsWith('incidents:'));
    expect(incidentEntries).toHaveLength(0);
  });

  it('flag-off: other records (projects etc.) are still indexed normally', () => {
    searchState.projects = {
      data: [{ id: 'p-flag', name: 'Gate Test Project', code: 'PRJ-FLAG' }],
      isPending: false,
      isError: false,
    };
    const { result } = renderHook(() => useRecordSearch(navigate), { wrapper: wrapAdmin });
    const proj = result.current.records.find((r) => r.id === 'projects:p-flag');
    expect(proj).toBeDefined();
    // Clean up
    searchState.projects = { data: [], isPending: false, isError: false };
  });

  // ── Flag ON (proves the gate is the indexing guard, not deleted code) ──────

  it('flag-on: incidents entries ARE indexed when isFeatureEnabled returns true', () => {
    spy = vi.spyOn(features, 'isFeatureEnabled').mockImplementation((key) =>
      key === 'incidents' ? true : features.FEATURES[key],
    );
    const { result } = renderHook(() => useRecordSearch(navigate), { wrapper: wrapAdmin });
    const incidentEntries = result.current.records.filter((r) => r.id.startsWith('incidents:'));
    expect(incidentEntries.length).toBeGreaterThan(0);
    expect(incidentEntries[0].id).toBe(`incidents:${INCIDENT_ROW.id}`);
  });
});
