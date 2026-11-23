import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import i18next from 'i18next';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const h = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-self', org_id: 'org-1' }, role: 'Finance' }),
}));
vi.mock('@/src/lib/repositories/invoiceApprovalRoute', () => ({
  invoiceApprovalRouteRepository: { get: h.get },
}));

import {
  invoiceApprovalRouteKey,
  invoiceWaitingForText,
  useInvoiceApprovalRoute,
  type InvoiceWaitingRoleLabels,
} from './useInvoiceApprovalRoute';

const load = (lng: 'en' | 'id', ns: string) => JSON.parse(readFileSync(join(process.cwd(), `public/locales/${lng}/${ns}.json`), 'utf8'));

const t = i18next.createInstance();
await t.init({
  lng: 'en',
  ns: ['waitingList', 'finance', 'common'],
  defaultNS: 'waitingList',
  resources: {
    en: { waitingList: load('en', 'waitingList'), finance: load('en', 'finance'), common: load('en', 'common') },
    id: { waitingList: load('id', 'waitingList'), finance: load('id', 'finance'), common: load('id', 'common') },
  },
  interpolation: { escapeValue: false },
});

const ROLE_KEY: Record<string, string> = { Finance: 'finance', Admin: 'admin', Engineer: 'engineer', Executive: 'executive', 'Project Manager': 'projectManager' };

// The real seam is useRoleLabels() over common:admin.roles.*; this mirrors that mapping per language.
const labels = (lng: 'en' | 'id'): InvoiceWaitingRoleLabels => {
  const roles = load(lng, 'common').admin.roles as Record<string, string>;
  return { role: (role: string) => roles[ROLE_KEY[role] ?? ''] ?? role };
};

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  return { qc, Wrapper };
}

beforeEach(() => { h.get.mockReset(); });

describe('FR-WAIT-006 useInvoiceApprovalRoute', () => {
  it('reads ONE visible invoice through the typed repository, keyed by real org + user + invoice', async () => {
    h.get.mockResolvedValue({
      routeKind: 'named',
      approvers: [{ id: 'u-fin', name: 'Finance Three', role: 'Finance' }],
    });
    const { qc, Wrapper } = makeWrapper();

    const { result } = renderHook(() => useInvoiceApprovalRoute('inv-1'), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.get).toHaveBeenCalledWith('inv-1');
    expect(JSON.stringify(h.get.mock.calls)).not.toContain('org_id');
    expect(qc.getQueryData(invoiceApprovalRouteKey('org-1', 'u-self', 'inv-1'))).toEqual({
      routeKind: 'named',
      approvers: [{ id: 'u-fin', name: 'Finance Three', role: 'Finance' }],
    });
  });

  it('is disabled for no invoice (any non-waiting invoice pays no read)', () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useInvoiceApprovalRoute(null), { wrapper: Wrapper });
    expect(h.get).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('surfaces a read failure as an error state so the screen can offer its own retry', async () => {
    h.get.mockRejectedValue(new Error('boom'));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useInvoiceApprovalRoute('inv-1'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('FR-WAIT-006 invoiceWaitingForText — route facts, not a flat label', () => {
  it('names the actual eligible people with their own database roles', () => {
    expect(invoiceWaitingForText({
      routeKind: 'named',
      approvers: [
        { id: 'u-fin', name: 'Finance Three', role: 'Finance' },
        { id: 'u-admin', name: 'Admin Four', role: 'Admin' },
      ],
    }, t.t, labels('en'))).toBe('Waiting for Finance Three, Finance or Admin Four, Admin');
  });

  it('falls back to the role word for a blank server name instead of inventing a person', () => {
    expect(invoiceWaitingForText({
      routeKind: 'named',
      approvers: [{ id: 'u-fin', name: '   ', role: 'Finance' }],
    }, t.t, labels('en'))).toBe('Waiting for Finance');
  });

  it('says nobody else can approve for a proven empty route, and says the author is missing for that state', () => {
    expect(invoiceWaitingForText({ routeKind: 'nobody', approvers: [] }, t.t, labels('en')))
      .toBe('No other Finance or Admin can approve this invoice right now.');
    expect(invoiceWaitingForText({ routeKind: 'missing_author', approvers: [] }, t.t, labels('en')))
      .toBe('This invoice has no recorded author, so it cannot be approved yet.');
  });

  it('shows no route sentence for the non-leaking unavailable shape, a pending read, or a nameless named body', () => {
    expect(invoiceWaitingForText({ routeKind: 'unavailable', approvers: [] }, t.t, labels('en'))).toBeNull();
    expect(invoiceWaitingForText(null, t.t, labels('en'))).toBeNull();
    expect(invoiceWaitingForText({ routeKind: 'named', approvers: [] }, t.t, labels('en'))).toBeNull();
  });

  it('words the same facts in Bahasa Indonesia', async () => {
    await t.changeLanguage('id');
    expect(invoiceWaitingForText({
      routeKind: 'named',
      approvers: [
        { id: 'u-fin', name: 'Ani', role: 'Finance' },
        { id: 'u-admin', name: 'Budi', role: 'Admin' },
      ],
    }, t.t, labels('id'))).toBe('Menunggu Ani, Keuangan atau Budi, Admin');
    expect(invoiceWaitingForText({ routeKind: 'nobody', approvers: [] }, t.t, labels('id')))
      .toBe('Saat ini tidak ada Keuangan atau Admin lain yang dapat menyetujui invoice ini.');
    expect(invoiceWaitingForText({ routeKind: 'missing_author', approvers: [] }, t.t, labels('id')))
      .toBe('Invoice ini tidak memiliki pembuat tercatat, sehingga belum dapat disetujui.');
    await t.changeLanguage('en');
  });
});
