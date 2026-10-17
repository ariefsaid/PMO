/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { useAssignableProfiles } from '@/src/hooks/useTasks';
import type { IntegrationBinding } from '@/src/lib/repositories/types';

export const mockBinding: IntegrationBinding = {
  org_id: 'org-1',
  external_tier: 'clickup',
  site_url: 'https://api.clickup.com',
  secret_ref: 'clickup_token_org_1',
  status: 'active',
  connected_by: 'u1',
  connected_at: '2026-01-01T00:00:00Z',
  disconnected_at: null,
  config: {},
};

export const baseExternalDomainReturn = {
  data: [],
  isPending: false,
  isError: false,
  isSuccess: true,
  isLoading: false,
  isFetching: false,
  refetch: vi.fn(),
  status: 'success' as const,
  dataUpdatedAt: 0,
  error: null,
  isPlaceholderData: false,
  fetchStatus: 'idle',
  isLoadingError: false,
  isRefetchError: false,
  errorUpdatedAt: 0,
  failureCount: 0,
  failureReason: null,
  isPaused: false,
  isRefetching: false,
  isStale: false,
} as any;

export const emptyProfilesReturn = {
  data: [],
  isPending: false,
  isError: false,
  isSuccess: true,
  isLoading: false,
  isFetching: false,
  status: 'success' as const,
  dataUpdatedAt: 0,
  error: null,
  isPlaceholderData: false,
  fetchStatus: 'idle',
  isLoadingError: false,
  isRefetchError: false,
  errorUpdatedAt: 0,
  failureCount: 0,
  failureReason: null,
  isPaused: false,
  isRefetching: false,
  isStale: false,
  refetch: vi.fn(),
} as any;

export function installIntegrationDefaults(): void {
  beforeEach(() => {
    vi.mocked(useAssignableProfiles).mockReturnValue(emptyProfilesReturn);
  });
  afterEach(() => {
    vi.clearAllMocks();
    cleanup();
  });
}

export const profile = (id: string, full_name: string) => ({
  id,
  full_name,
  org_id: 'org-1',
  role: 'Admin',
});

export const wrapWithRole = (role: string, ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ImpersonationProvider realRole={role as any}>
        {ui}
      </ImpersonationProvider>
    </QueryClientProvider>
  );
};

export const bindingMapIntegrations = (overrides: Record<string, unknown> = {}) => ({
  orgId: 'org-1',
  bindings: [mockBinding],
  isPending: false,
  isError: false,
  isSuccess: true,
  error: null,
  refetch: vi.fn(),
  connect: { mutateAsync: vi.fn(), isPending: false },
  disconnect: { mutateAsync: vi.fn(), isPending: false },
  getBinding: vi.fn((tier: string) => (tier === 'clickup' ? mockBinding : undefined)),
  getHealth: vi.fn().mockResolvedValue(null),
  clickupLists: [],
  isListsPending: false,
  isListsError: false,
  projectBindings: [],
  isBindingsPending: false,
  ...overrides,
});

export const project = (id: string, name: string, archived_at: string | null = null) => ({
  id, name, archived_at, org_id: 'org-1', status: 'Active', client_id: null,
  project_manager_id: null, client: null, pm: null,
});

const testEnCatalogue = JSON.parse(
  readFileSync(join(process.cwd(), 'public/locales/en/common.json'), 'utf8'),
);
const testIdCatalogue = JSON.parse(
  readFileSync(join(process.cwd(), 'public/locales/id/common.json'), 'utf8'),
);

export function wrapWithRoleAndLocale(role: string, lng: string, ui: React.ReactElement) {
  const i18n = i18next.createInstance();
  return i18n
    .init({
      lng,
      fallbackLng: 'en',
      defaultNS: 'common',
      resources: { en: { common: testEnCatalogue }, id: { common: testIdCatalogue } },
    })
    .then(() => {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      return render(
        <QueryClientProvider client={qc}>
          <ImpersonationProvider realRole={role as any}>
            <I18nextProvider i18n={i18n}>{ui}</I18nextProvider>
          </ImpersonationProvider>
        </QueryClientProvider>
      );
    });
}
