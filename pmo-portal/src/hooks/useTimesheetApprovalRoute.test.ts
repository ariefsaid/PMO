import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import i18next from 'i18next';
import enWaitingList from '../../public/locales/en/waitingList.json';
import enCommon from '../../public/locales/en/common.json';
import idWaitingList from '../../public/locales/id/waitingList.json';
import idCommon from '../../public/locales/id/common.json';

const h = vi.hoisted(() => ({ getApprovalRoute: vi.fn() }));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-self', org_id: 'org-1' }, role: 'Engineer' }),
}));
vi.mock('@/src/lib/repositories', () => ({
  repositories: { timesheet: { getApprovalRoute: h.getApprovalRoute } },
}));

import {
  timesheetApprovalRouteKey,
  timesheetWaitingForText,
  useTimesheetApprovalRoute,
} from './useTimesheetApprovalRoute';

const t = i18next.createInstance();
await t.init({
  lng: 'en',
  ns: ['waitingList', 'common'],
  defaultNS: 'waitingList',
  resources: {
    en: { waitingList: enWaitingList, common: enCommon },
    id: { waitingList: idWaitingList, common: idCommon },
  },
  interpolation: { escapeValue: false },
});

const labels = { lineManager: 'line manager', role: (role: string) => role };

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  return { qc, Wrapper };
}

// Block-bodied on purpose: `mockReset()` RETURNS the mock, and Vitest registers any function returned
// from `beforeEach` as an after-test cleanup — a phantom call that would reject with the body's own
// armed mock value and fail an otherwise passing test.
beforeEach(() => { h.getApprovalRoute.mockReset(); });

describe('FR-WAIT-006 useTimesheetApprovalRoute', () => {
  it('reads ONE visible Submitted id through the typed repository, keyed by real org + user + sheet', async () => {
    h.getApprovalRoute.mockResolvedValue({ routeKind: 'unavailable', approvers: [] });
    const { qc, Wrapper } = makeWrapper();

    const { result } = renderHook(() => useTimesheetApprovalRoute('ts-1'), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.getApprovalRoute).toHaveBeenCalledWith('ts-1');
    expect(JSON.stringify(h.getApprovalRoute.mock.calls)).not.toContain('org_id');
    expect(qc.getQueryData(timesheetApprovalRouteKey('org-1', 'u-self', 'ts-1'))).toEqual({
      routeKind: 'unavailable', approvers: [],
    });
  });

  it('is disabled for no sheet (a draft / absent week pays no read)', () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useTimesheetApprovalRoute(null), { wrapper: Wrapper });
    expect(h.getApprovalRoute).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('surfaces a read failure as an error state so the screen can offer a retry', async () => {
    h.getApprovalRoute.mockRejectedValue(new Error('boom'));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useTimesheetApprovalRoute('ts-1'), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    // A failed read is the screen's RETRY state, never a rendered route: React Query holds the failure
    // (it does not throw it out of the hook), no approver is fabricated, and `refetch` is the affordance
    // the page binds its Retry button to.
    expect(result.current.data).toBeUndefined();
    expect(result.current.error?.message).toBe('boom');
    expect(typeof result.current.refetch).toBe('function');
  });
});

describe('FR-WAIT-006 timesheetWaitingForText — route facts, not a flat label', () => {
  it('names the actual manager and their role, with Admin as a true alternative', () => {
    expect(timesheetWaitingForText({
      routeKind: 'line_manager',
      approvers: [
        { id: 'm', name: 'Ani', role: 'line_manager' },
        { id: 'a', name: 'Budi', role: 'Admin' },
      ],
    }, t.t, labels)).toBe('Waiting for Ani, line manager or Admin');
  });

  it('names the actual Admin and Executive people with their current roles when no manager is assigned', () => {
    expect(timesheetWaitingForText({
      routeKind: 'admin_executive',
      approvers: [
        { id: 'a', name: 'Budi', role: 'Admin' },
        { id: 'e', name: 'Cici', role: 'Executive' },
      ],
    }, t.t, labels)).toBe('Waiting for Budi, Admin or Cici, Executive');
  });

  it('falls back to the role word when the server supplies a blank full_name (never a fabricated name)', () => {
    expect(timesheetWaitingForText({
      routeKind: 'line_manager',
      approvers: [{ id: 'm', name: '   ', role: 'line_manager' }],
    }, t.t, labels)).toBe('Waiting for line manager');
    expect(timesheetWaitingForText({
      routeKind: 'admin_executive',
      approvers: [
        { id: 'a', name: '', role: 'Admin' },
        { id: 'e', name: '  ', role: 'Executive' },
      ],
    }, t.t, labels)).toBe('Waiting for Admin or Executive');
  });

  it('says nobody active holds the deciding role when the configured route is known and empty', () => {
    expect(timesheetWaitingForText({ routeKind: 'line_manager', approvers: [] }, t.t, labels))
      .toBe('Nobody active holds these roles right now.');
    expect(timesheetWaitingForText({ routeKind: 'admin_executive', approvers: [] }, t.t, labels))
      .toBe('Nobody active holds these roles right now.');
  });

  it('shows no route for the non-leaking unavailable shape (not submitted / not visible)', () => {
    expect(timesheetWaitingForText({ routeKind: 'unavailable', approvers: [] }, t.t, labels)).toBeNull();
    expect(timesheetWaitingForText(null, t.t, labels)).toBeNull();
  });

  it('words the same facts in Bahasa Indonesia', async () => {
    await t.changeLanguage('id');
    const idLabels = { lineManager: 'atasan langsung', role: (role: string) => role === 'Admin' ? 'Admin' : role };
    expect(timesheetWaitingForText({
      routeKind: 'line_manager',
      approvers: [
        { id: 'm', name: 'Ani', role: 'line_manager' },
        { id: 'a', name: 'Budi', role: 'Admin' },
      ],
    }, t.t, idLabels)).toBe('Menunggu Ani, atasan langsung atau Admin');
    await t.changeLanguage('en');
  });
});
