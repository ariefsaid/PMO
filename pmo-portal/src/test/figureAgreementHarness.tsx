import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { AuthProvider } from '@/src/auth/AuthProvider';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { Role, Profile } from '@/src/auth/AuthContext';
import { I18nProvider } from '@/src/lib/i18n/I18nProvider';
import { ToastProvider } from '@/src/components/ui';
import { figureAgreementFixture } from './fixtures/figureAgreement';
import type { FigureAgreementRoute } from './figureAgreementRoutes';

declare global {
  // The Supabase auth mock in the agreement specs reads this profile exactly as the real
  // AuthProvider's profile lookup would return it. Screens still consume the real AuthContext.
  var __figureAgreementAuth: { session: unknown; profile: Profile | null } | undefined;
}

function profileForRole(role: Role): Profile {
  const profile = Object.values(figureAgreementFixture.users).find((user) => user.role === role);
  if (!profile) throw new Error(`No figure-agreement profile for role ${role}`);
  return {
    full_name: `Synthetic ${role}`,
    ...profile,
    email: `${profile.id}@figure-agreement.test`,
    manager_id: null,
    status: 'active',
    company_id: null,
    avatar_url: null,
    title: null,
    location: null,
    skills: [],
    utilization: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

export function selectFigureAgreementIdentity(role: Role): void {
  const profile = profileForRole(role);
  globalThis.__figureAgreementAuth = {
    session: { user: { id: profile.id } },
    profile,
  };
}

export function renderFigureAgreementRoute(
  mount: FigureAgreementRoute,
  options: { beforeRender?: () => void } = {},
): RenderResult & { queryClient: QueryClient } {
  selectFigureAgreementIdentity(mount.role);
  if (mount.layout) localStorage.setItem('home-layout', mount.layout);
  if (mount.view) sessionStorage.setItem('pmo.workspace.views', JSON.stringify({ projects: mount.view }));
  options.beforeRender?.();

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  const Screen = mount.component;
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <I18nProvider>
          <ImpersonationProvider realRole={mount.role}>
            <ToastProvider>
              <MemoryRouter initialEntries={[mount.location]}>
                <Routes>
                  <Route path={mount.matchPath} element={<Screen />} />
                </Routes>
              </MemoryRouter>
            </ToastProvider>
          </ImpersonationProvider>
        </I18nProvider>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { ...rendered, queryClient };
}
