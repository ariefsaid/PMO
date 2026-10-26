/**
 * FR-L10N — the selected Users and Credits route jobs render as the translated h1 in a Bahasa
 * session. The task navigation keeps its own translated labels below the route heading.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import React from 'react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Load the REAL shipped catalogues (tests run with cwd = pmo-portal) so the assertions pin the
// actual Bahasa labels the shell ships.
const enCatalogue = JSON.parse(
  readFileSync(join(process.cwd(), 'public/locales/en/common.json'), 'utf8'),
);
const idCatalogue = JSON.parse(
  readFileSync(join(process.cwd(), 'public/locales/id/common.json'), 'utf8'),
);

vi.mock('@/src/hooks/useUsers', () => ({
  useUsers: () => ({
    data: [
      { id: 'self-admin', full_name: 'Org Admin', email: 'admin@example.com', role: 'Admin', manager_id: null, org_id: 'org-1', status: 'active' },
    ],
    isPending: false,
    isError: false,
    refetch: () => {},
  }),
  useUserMutations: () => ({
    updateRole: { mutateAsync: () => Promise.resolve(), isPending: false },
    assignManager: { mutateAsync: () => Promise.resolve(), isPending: false },
    invite: { mutateAsync: () => Promise.resolve(), isPending: false },
    setStatus: { mutateAsync: () => Promise.resolve(), isPending: false },
  }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'self-admin', org_id: 'org-1' }, role: 'Admin' }),
}));
vi.mock('@/src/auth/useIsOperator', () => ({
  useIsOperator: () => false,
  useOperatorMembership: () => ({ isOperator: false, isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useUsage', () => ({
  useUsage: () => ({ data: [], isPending: false, isError: false, refetch: () => {} }),
  useAgentRunStats: () => ({ data: [], isPending: false, isError: false, refetch: () => {} }),
}));
vi.mock('@/src/hooks/useOrgFeatures', () => ({
  useOrgFeatures: () => ({ data: {} }),
}));
vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    credits: { getOrgBalance: () => Promise.resolve(100), grant: () => Promise.resolve(undefined) },
    orgFeature: { listOwn: () => Promise.resolve({}), toggle: () => Promise.resolve(undefined) },
  },
}));

import Administration from '../Administration';

let i18n: typeof i18next;

beforeEach(async () => {
  i18n = i18next.createInstance();
  await i18n.init({
    lng: 'id',
    fallbackLng: 'en',
    defaultNS: 'common',
    resources: { id: { common: idCatalogue }, en: { common: enCatalogue } },
  });
});

const renderPage = (section: 'users' | 'credits') =>
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ImpersonationProvider realRole="Admin">
          <MemoryRouter initialEntries={[`/administration/${section}`]}>
            <ToastProvider>
              <Administration />
            </ToastProvider>
          </MemoryRouter>
        </ImpersonationProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  );

describe('FR-L10N — Users & Credits route headings render in Bahasa', () => {
  it('renders the Users route job as the h1 "Pengguna"', () => {
    renderPage('users');
    expect(screen.getByRole('heading', { level: 1, name: 'Pengguna' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Users' })).not.toBeInTheDocument();
  });

  it('renders the Credits route job as the h1 "Kredit"', () => {
    renderPage('credits');
    expect(screen.getByRole('heading', { level: 1, name: 'Kredit' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Credits' })).not.toBeInTheDocument();
  });
});
