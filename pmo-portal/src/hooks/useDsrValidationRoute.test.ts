import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import i18next from 'i18next';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const h = vi.hoisted(() => ({ validationRoute: vi.fn() }));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-self', org_id: 'org-1' }, role: 'Engineer' }),
}));
vi.mock('@/src/lib/repositories', () => ({
  repositories: { dailySiteReport: { validationRoute: h.validationRoute } },
}));

import {
  dsrValidationRouteKey,
  dsrWaitingForText,
  useDsrValidationRoute,
  type DsrWaitingRoleLabels,
} from './useDsrValidationRoute';

const load = (lng: 'en' | 'id', ns: string) => JSON.parse(readFileSync(join(process.cwd(), `public/locales/${lng}/${ns}.json`), 'utf8'));

const t = i18next.createInstance();
await t.init({
  lng: 'en',
  ns: ['waitingList', 'siteReport', 'common'],
  defaultNS: 'waitingList',
  resources: {
    en: { waitingList: load('en', 'waitingList'), siteReport: load('en', 'siteReport'), common: load('en', 'common') },
    id: { waitingList: load('id', 'waitingList'), siteReport: load('id', 'siteReport'), common: load('id', 'common') },
  },
  interpolation: { escapeValue: false },
});

const ROLE_KEY: Record<string, string> = {
  Engineer: 'engineer', 'Project Manager': 'projectManager', Finance: 'finance', Executive: 'executive', Admin: 'admin',
};

// The real seam is useRoleLabels() over common:admin.roles.*; this mirrors that mapping per language.
const labels = (lng: 'en' | 'id'): DsrWaitingRoleLabels => {
  const roles = load(lng, 'common').admin.roles as Record<string, string>;
  return {
    role: (role: string) => roles[ROLE_KEY[role] ?? ''] ?? role,
    financeAdmin: t.getFixedT(lng, 'waitingList')('waitingFor.roleFinanceAdmin'),
    nobody: t.getFixedT(lng, 'siteReport')('detail.nobodyCanValidate'),
    unavailable: t.getFixedT(lng, 'common')('uxs32.routeUnavailable'),
  };
};

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  return { qc, Wrapper };
}

beforeEach(() => h.validationRoute.mockReset());

describe('FR-WAIT-006 useDsrValidationRoute', () => {
  it('reads ONE visible Submitted report through the typed repository, keyed by real org + user + report', async () => {
    h.validationRoute.mockResolvedValue({ routeKind: 'unavailable', approvers: [] });
    const { qc, Wrapper } = makeWrapper();

    const { result } = renderHook(() => useDsrValidationRoute('r1'), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.validationRoute).toHaveBeenCalledWith('r1');
    expect(JSON.stringify(h.validationRoute.mock.calls)).not.toContain('org_id');
    expect(qc.getQueryData(dsrValidationRouteKey('org-1', 'u-self', 'r1'))).toEqual({
      routeKind: 'unavailable', approvers: [],
    });
  });

  it('is disabled for no report (a draft / returned / absent report pays no read)', () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useDsrValidationRoute(null), { wrapper: Wrapper });
    expect(h.validationRoute).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('surfaces a read failure as an error state so the screen can offer a retry', async () => {
    h.validationRoute.mockRejectedValue(new Error('boom'));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useDsrValidationRoute('r1'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('FR-WAIT-006 dsrWaitingForText — route facts, not a flat label', () => {
  it('names the actual PM with their own database role, and Finance/Admin as the true alternatives', () => {
    expect(dsrWaitingForText({
      routeKind: 'project_manager',
      approvers: [{ id: 'pm', name: 'Rina Wati', role: 'Project Manager' }],
    }, t.t, labels('en'))).toBe('Waiting for Rina Wati, Project Manager or Finance or Admin');
  });

  it('falls back to the stored role value when the role-label seam has no word for it', () => {
    expect(dsrWaitingForText({
      routeKind: 'project_manager',
      approvers: [{ id: 'pm', name: 'Rina Wati', role: 'Project Manager' }],
    }, t.t, { ...labels('en'), role: () => '' })).toBe('Waiting for Rina Wati, Project Manager or Finance or Admin');
  });

  it('speaks the Finance/Admin fallback as roles when no PM is (or can be) named', () => {
    expect(dsrWaitingForText({ routeKind: 'finance_admin', approvers: [] }, t.t, labels('en')))
      .toBe('Waiting for Finance or Admin');
  });

  it('says nobody active can validate for a proven empty route, never a project approver', () => {
    expect(dsrWaitingForText({ routeKind: 'nobody', approvers: [] }, t.t, labels('en')))
      .toBe('Nobody active can validate this report right now.');
  });

  it('shows no route sentence for the non-leaking unavailable shape, a pending read, or a nameless PM body', () => {
    expect(dsrWaitingForText({ routeKind: 'unavailable', approvers: [] }, t.t, labels('en'))).toBeNull();
    expect(dsrWaitingForText(null, t.t, labels('en'))).toBeNull();
    expect(dsrWaitingForText({ routeKind: 'project_manager', approvers: [] }, t.t, labels('en'))).toBeNull();
  });

  it('words the same facts in Bahasa Indonesia', async () => {
    await t.changeLanguage('id');
    expect(dsrWaitingForText({
      routeKind: 'project_manager',
      approvers: [{ id: 'pm', name: 'Rina Wati', role: 'Project Manager' }],
    }, t.t, labels('id'))).toBe('Menunggu Rina Wati, Manajer proyek atau Keuangan atau Admin');
    expect(dsrWaitingForText({ routeKind: 'finance_admin', approvers: [] }, t.t, labels('id')))
      .toBe('Menunggu Keuangan atau Admin');
    expect(dsrWaitingForText({ routeKind: 'nobody', approvers: [] }, t.t, labels('id')))
      .toBe('Saat ini tidak ada anggota aktif yang dapat memvalidasi laporan ini.');
    await t.changeLanguage('en');
  });
});
