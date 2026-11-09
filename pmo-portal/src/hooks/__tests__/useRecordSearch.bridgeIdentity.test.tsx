/**
 * #2096 review — the ⌘K record-search store is MODULE-GLOBAL and outlives the lazily-mounted
 * bridge, so it must never carry one user's rows into another user's session.
 *
 * Break it (before the fix): user A opens ⌘K (the store holds A's project rows) → signs out
 * (the authenticated shell unmounts; `/login` is a separate route) → user B signs in in the same
 * tab and opens ⌘K before the lazy bridge's first (empty) publish lands. The palette then renders
 * and can match A's row titles/codes. The always-mounted pre-split hook could not leak this.
 *
 * Pins both halves of the fix: the bridge clears the store on unmount, and an identity change
 * under a still-mounted bridge clears it before anything from the previous user can be shown.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, renderHook } from '@testing-library/react';
import React from 'react';

type ListState = { data: unknown; isPending: boolean; isError: boolean };
const emptyList = (): ListState => ({ data: undefined, isPending: false, isError: false });

const { state, auth } = vi.hoisted(() => ({
  state: {
    projects: { data: undefined, isPending: false, isError: false },
    procurements: { data: undefined, isPending: false, isError: false },
    pipeline: { data: undefined, isPending: false, isError: false },
    companies: { data: undefined, isPending: false, isError: false },
    contacts: { data: undefined, isPending: false, isError: false },
    incidents: { data: undefined, isPending: false, isError: false },
  } as Record<string, { data: unknown; isPending: boolean; isError: boolean }>,
  auth: { currentUser: { id: 'user-a', org_id: 'org-a' } as { id: string; org_id: string } | null },
}));

vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => state.projects }));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => state.procurements }));
vi.mock('@/src/hooks/useDashboard', () => ({ useSalesPipeline: () => state.pipeline }));
vi.mock('@/src/hooks/useCompanies', () => ({ useCompanies: () => state.companies }));
vi.mock('@/src/hooks/useContacts', () => ({ useContacts: () => state.contacts }));
vi.mock('@/src/hooks/useIncidents', () => ({ useIncidents: () => state.incidents }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: auth.currentUser }) }));

import RecordSearchDataBridge from '../useRecordSearchData';
import { publishRecordSearch, useRecordSearch } from '../useRecordSearch';
import { ImpersonationProvider } from '@/src/auth/impersonation';

const projectRow = (id: string, name: string) => ({ id, name });

function renderBridge() {
  return render(
    <ImpersonationProvider realRole="Admin">
      <RecordSearchDataBridge open navigate={() => {}} />
    </ImpersonationProvider>,
  );
}

/** The App-side view of the store — exactly what the palette renders. */
function store() {
  return renderHook(() => useRecordSearch());
}

beforeEach(() => {
  state.projects = emptyList();
  state.procurements = emptyList();
  state.pipeline = emptyList();
  state.companies = emptyList();
  state.contacts = emptyList();
  state.incidents = emptyList();
  auth.currentUser = { id: 'user-a', org_id: 'org-a' };
  act(() => publishRecordSearch({ records: [], isPending: false, isError: false }));
});

afterEach(() => {
  act(() => publishRecordSearch({ records: [], isPending: false, isError: false }));
});

describe('useRecordSearch bridge identity scoping (#2096 review)', () => {
  it('publishes the first mount\'s rows (a warm cache still reaches the palette on the first open)', () => {
    state.projects = { data: [projectRow('p1', 'Harbour Expansion')], isPending: false, isError: false };
    const view = store();
    renderBridge();
    expect(view.result.current.records.map((r) => r.id)).toContain('projects:p1');
  });

  it('clears the store when the bridge unmounts (sign-out unmounts the authenticated shell)', () => {
    state.projects = { data: [projectRow('p1', 'Harbour Expansion')], isPending: false, isError: false };
    const view = store();
    const bridge = renderBridge();
    expect(view.result.current.records.map((r) => r.id)).toContain('projects:p1');

    bridge.unmount();

    expect(view.result.current.records).toEqual([]);
  });

  it('never shows user A\'s rows to user B when the identity changes under a mounted bridge', () => {
    state.projects = { data: [projectRow('p1', 'Harbour Expansion')], isPending: false, isError: false };
    const view = store();
    const bridge = renderBridge();
    expect(view.result.current.records.map((r) => r.id)).toContain('projects:p1');

    // Sign-in as another user in the same tab. The lists have NOT re-keyed yet (the cache clear
    // lands a tick later), so this render still holds A's rows — the exact window the review
    // names. The store must not keep serving them under B's identity.
    act(() => {
      auth.currentUser = { id: 'user-b', org_id: 'org-a' };
    });
    bridge.rerender(
      <ImpersonationProvider realRole="Admin">
        <RecordSearchDataBridge open navigate={() => {}} />
      </ImpersonationProvider>,
    );

    expect(view.result.current.records).toEqual([]);
  });
});
