// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const authState = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  currentUser: null as { id: string; org_id: string; locale: string | null; number_locale: string | null; timezone: string | null } | null,
}));

const getOrgLocaleDefaultsMock = vi.hoisted(() =>
  vi.fn(async () => ({
    defaultLocale: 'id',
    defaultNumberLocale: 'id-ID',
    defaultTimezone: 'Asia/Jakarta',
  })),
);

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({
    session: authState.session,
    currentUser: authState.currentUser,
    loading: !authState.currentUser,
  }),
}));

vi.mock('@/src/lib/db/orgs', () => ({
  getOrgLocaleDefaults: getOrgLocaleDefaultsMock,
}));

import { repositories } from './index';
import { orgDefaultsRepository } from './orgDefaults';
import { useOrgDefaultsReady } from '@/src/hooks/useResolvedLocale';

describe('boot-critical orgDefaults repository (P3)', () => {
  beforeEach(() => {
    authState.session = null;
    authState.currentUser = null;
    getOrgLocaleDefaultsMock.mockClear();
  });

  it('wires repositories.orgDefaults statically to orgDefaultsRepository without lazy-loading admin', async () => {
    expect(repositories.orgDefaults).toBe(orgDefaultsRepository);
    const result = await repositories.orgDefaults.getLocaleDefaults();
    expect(result).toEqual({
      defaultLocale: 'id',
      defaultNumberLocale: 'id-ID',
      defaultTimezone: 'Asia/Jakarta',
    });
    expect(getOrgLocaleDefaultsMock).toHaveBeenCalledTimes(1);
  });

  it('starts the organisation defaults read as soon as the session is known, before currentUser resolves', async () => {
    authState.session = { user: { id: 'u1' } };
    authState.currentUser = null;

    function Probe() {
      const ready = useOrgDefaultsReady();
      return <span data-testid="ready">{String(ready)}</span>;
    }

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(getOrgLocaleDefaultsMock).toHaveBeenCalledTimes(1));
  });
});
