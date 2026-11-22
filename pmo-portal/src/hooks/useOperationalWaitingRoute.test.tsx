import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import type { TFunction } from 'i18next';

const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/src/lib/repositories/operationalWaitingRoute', () => ({
  operationalWaitingRouteRepository: { get: h.get },
}));

const auth = vi.hoisted(() => ({ user: { id: 'u-1', org_id: 'org-1' } as { id: string; org_id?: string } | null }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: auth.user }) }));

import i18n from '@/src/lib/i18n';
import { useOperationalWaitingRoute, operationalWaitingForText } from './useOperationalWaitingRoute';

const Wrapper = ({ children }: { children: React.ReactNode }) => {
  const [client] = React.useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

const t = i18n.t.bind(i18n) as unknown as TFunction;

beforeEach(async () => {
  h.get.mockReset();
  auth.user = { id: 'u-1', org_id: 'org-1' };
  await i18n.changeLanguage('en');
});

describe('useOperationalWaitingRoute', () => {
  it('does not read until the record is actually waiting', async () => {
    const { result } = renderHook(() => useOperationalWaitingRoute('work_order_issue', 'wo-1', false), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
    expect(h.get).not.toHaveBeenCalled();
  });

  it('does not read without an organisation or a signed-in person', async () => {
    auth.user = { id: 'u-1' };
    const { result } = renderHook(() => useOperationalWaitingRoute('delivery_record', 'p-1', true), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
    expect(h.get).not.toHaveBeenCalled();
  });

  it('reads the single record with its kind while it is waiting', async () => {
    h.get.mockResolvedValue({ approvers: [{ id: 'u-2', name: 'Ani', role: 'Finance' }], routeKind: 'work_order_issue' });
    const { result } = renderHook(() => useOperationalWaitingRoute('work_order_issue', 'wo-1', true), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.data).toEqual({
      approvers: [{ id: 'u-2', name: 'Ani', role: 'Finance' }],
      routeKind: 'work_order_issue',
    }));
    expect(h.get).toHaveBeenCalledWith('work_order_issue', 'wo-1');
  });

  it('keys the cache by the real signed-in person, so a different viewer gets their own route', async () => {
    h.get.mockResolvedValue({ approvers: [], routeKind: 'delivery_record' });
    const { result, rerender } = renderHook(() => useOperationalWaitingRoute('delivery_record', 'p-1', true), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(h.get).toHaveBeenCalledTimes(1);

    auth.user = { id: 'u-2', org_id: 'org-1' };
    rerender();

    await waitFor(() => expect(h.get).toHaveBeenCalledTimes(2));
  });

  it('surfaces a refusal instead of inventing people', async () => {
    h.get.mockRejectedValue(new Error('unavailable'));
    const { result } = renderHook(() => useOperationalWaitingRoute('transfer_receipt', 't-1', true), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});

describe('operationalWaitingForText', () => {
  const route = {
    approvers: [
      { id: 'u-1', name: 'Ani', role: 'Finance' },
      { id: 'u-2', name: 'Budi', role: 'Project Manager' },
    ],
    routeKind: 'work_order_issue',
  };

  it('names the actual people and their actual roles through the canonical sentence', () => {
    expect(operationalWaitingForText(route, t, { roleLabel: (role) => role }))
      .toBe('Waiting for Ani or Budi, Finance or Project Manager');
  });

  it('uses a single role label when every named person holds it', () => {
    expect(operationalWaitingForText(
      { approvers: [{ id: 'u-1', name: 'Ani', role: 'Finance' }], routeKind: 'delivery_record' },
      t,
      { roleLabel: (role) => role },
    )).toBe('Waiting for Ani, Finance');
  });

  it('never invents a name: a known empty route says the plain sentence or nothing', () => {
    expect(operationalWaitingForText({ approvers: [], routeKind: 'delivery_record' }, t, { empty: 'plain' }))
      .toBe('Waiting for approval');
    expect(operationalWaitingForText({ approvers: [], routeKind: 'transfer_receipt' }, t, { empty: 'none' }))
      .toBeNull();
  });

  it('says nothing while there is no answer at all', () => {
    expect(operationalWaitingForText(undefined, t)).toBeNull();
  });
});
