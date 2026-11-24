/**
 * Every page a light account can open renders inside the REAL light shell, with the real page code: a page that
 * needs a provider the light shell does not mount (the delivery page needed the role provider and threw for every
 * Field user, #1122) fails here. Only the database client is faked, so nothing but a thrown error can fail a page.
 * The route list comes from the shell itself: a page added to it is covered without touching this file.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { AuthContext } from '@/src/auth/AuthContext';
import { signedOutAuth } from '@/test/signedOutTestAuth';
import { makeTestQueryClient } from '@/test/testQueryClient';

vi.mock('@/src/lib/supabase/client', () => {
  // Any chain of calls on the client ends in an empty, successful answer.
  const answer = { data: [], error: null, count: 0 };
  const chain: unknown = new Proxy(function () {}, {
    get: (_t, key) => {
      if (key === 'then') return (ok: (v: unknown) => unknown) => Promise.resolve(answer).then(ok);
      if (key === 'single' || key === 'maybeSingle') return () => Promise.resolve({ data: null, error: null });
      return chain;
    },
    apply: () => chain,
  });
  return { supabase: chain };
});

import { LightShell } from './LightShell';
import { LIGHT_ROUTE_PATHS } from './lightPages';

const light = { id: 'u1', org_id: 'o1', full_name: 'Field Person', built_in_role: 'field_user', role: 'Engineer', locale: 'en' };

afterEach(() => vi.restoreAllMocks());

describe('the light shell mounts every provider its pages need', () => {
  it('lists the pages a light account can reach', () => {
    expect(LIGHT_ROUTE_PATHS).toEqual(expect.arrayContaining(['/my', '/stock/transfers/:transferId', '/settings/profile']));
  });

  it.each(LIGHT_ROUTE_PATHS)('%s renders without a thrown error', async (path) => {
    const crashed = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const auth = { ...signedOutAuth(), currentUser: light, role: 'Engineer' } as unknown as ReturnType<typeof signedOutAuth>;
    const { container } = render(
      <AuthContext.Provider value={auth}>
        <QueryClientProvider client={makeTestQueryClient()}>
          <MemoryRouter initialEntries={[path.replace(':transferId', 't1')]}><LightShell /></MemoryRouter>
        </QueryClientProvider>
      </AuthContext.Provider>,
    );
    // The loading fallback sits right after the header until the page's chunk has loaded; then let its first reads settle.
    await waitFor(() => expect(container.querySelector('header + [role="status"]')).toBeNull(), { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 200));
    const boundary = crashed.mock.calls.find((c) => String(c[0]).includes('ErrorBoundary caught'));
    expect(boundary?.[1]).toBeUndefined();   // the error the boundary caught, if any
  });
});
