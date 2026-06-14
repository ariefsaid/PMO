import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// The hooks consume the repository seam (ADR-0017), not the DAL directly.
const { incident } = vi.hoisted(() => ({
  incident: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    transition: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { incident } }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Admin' }),
}));

import { useIncidents, useIncident, useIncidentMutations } from './useIncidents';

const wrap = (client: QueryClient) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };

const freshClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });

const seed = [
  {
    id: 'i1',
    org_id: 'org-1',
    incident_date: '2026-03-15',
    type: 'Near Miss',
    severity: 'Low',
    location: 'Site B',
    description: 'Trip hazard',
    status: 'Open',
    reported_by: 'u1',
    created_at: '2026-03-15T00:00:00Z',
  },
];

beforeEach(() => {
  incident.list.mockResolvedValue(seed);
  incident.create.mockResolvedValue({ ...seed[0], id: 'i2', type: 'Spill' });
  incident.update.mockResolvedValue(undefined);
  incident.transition.mockResolvedValue(undefined);
  incident.delete.mockResolvedValue(undefined);
});

describe('useIncidents', () => {
  it("AC-IN-001: keys by ['incidents', orgId] and returns incident rows", async () => {
    const { result } = renderHook(() => useIncidents(), { wrapper: wrap(freshClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].type).toBe('Near Miss');
    expect(incident.list).toHaveBeenCalledWith(undefined);
  });

  it('AC-IN-001: passes a status filter through to the repository', async () => {
    const { result } = renderHook(() => useIncidents('Investigating'), { wrapper: wrap(freshClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(incident.list).toHaveBeenCalledWith({ status: 'Investigating' });
  });
});

describe('useIncident', () => {
  beforeEach(() => {
    incident.get.mockResolvedValue(seed[0]);
  });

  it("AC-IN-002: keys by ['incident', orgId, id] and returns the single record", async () => {
    const { result } = renderHook(() => useIncident('i1'), { wrapper: wrap(freshClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.type).toBe('Near Miss');
    expect(incident.get).toHaveBeenCalledWith('i1');
  });

  it('AC-IN-002: stays disabled (never fetches) when no id is supplied', () => {
    incident.get.mockClear();
    const { result } = renderHook(() => useIncident(undefined), { wrapper: wrap(freshClient()) });
    expect(result.current.fetchStatus).toBe('idle');
    expect(incident.get).not.toHaveBeenCalled();
  });
});

describe('useIncidentMutations', () => {
  it('AC-IN-003: create invokes the repository and invalidates the incidents query', async () => {
    const client = freshClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useIncidentMutations(), { wrapper: wrap(client) });
    const input = { incident_date: '2026-06-08', type: 'Spill', severity: 'High' as const };
    await act(async () => {
      await result.current.create.mutateAsync(input);
    });
    expect(incident.create).toHaveBeenCalledWith(input);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['incidents'] });
  });

  it('AC-IN-004: update invokes the repository with id + input', async () => {
    const { result } = renderHook(() => useIncidentMutations(), { wrapper: wrap(freshClient()) });
    const input = { incident_date: '2026-06-08', type: 'Spill', severity: 'High' as const };
    await act(async () => {
      await result.current.update.mutateAsync({ id: 'i1', input });
    });
    expect(incident.update).toHaveBeenCalledWith('i1', input);
  });

  it('AC-IN-004: transition invokes the repository with id + target status', async () => {
    const { result } = renderHook(() => useIncidentMutations(), { wrapper: wrap(freshClient()) });
    await act(async () => {
      await result.current.transition.mutateAsync({ id: 'i1', status: 'Investigating' });
    });
    expect(incident.transition).toHaveBeenCalledWith('i1', 'Investigating');
  });

  it('AC-IN-005: remove invokes the repository with the id', async () => {
    const { result } = renderHook(() => useIncidentMutations(), { wrapper: wrap(freshClient()) });
    await act(async () => {
      await result.current.remove.mutateAsync('i1');
    });
    expect(incident.delete).toHaveBeenCalledWith('i1');
  });
});
