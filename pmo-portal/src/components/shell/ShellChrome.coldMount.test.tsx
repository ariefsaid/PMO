/**
 * AC-OVERFETCH-001: a cold mount of the shell with the ⌘K palette closed fires NO list DAL call —
 * guards `useRecordSearch({ enabled: paletteOpen })` against silently regressing to eager loading.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { dal } = vi.hoisted(() => ({
  dal: {
    listProjects: vi.fn(async () => []),
    listProcurements: vi.fn(async () => []),
    getSalesPipeline: vi.fn(async () => ({ projects: [], stages: [] })),
    list: vi.fn(async () => []),
  },
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1', full_name: 'U' }, role: 'Admin', signOut: vi.fn() }),
}));
vi.mock('@/src/lib/db/projects', async (orig) => ({
  ...((await orig()) as object),
  listProjects: dal.listProjects,
}));
vi.mock('@/src/lib/db/procurements', async (orig) => ({
  ...((await orig()) as object),
  listProcurements: dal.listProcurements,
}));
vi.mock('@/src/lib/db/dashboard', async (orig) => ({
  ...((await orig()) as object),
  getSalesPipeline: dal.getSalesPipeline,
}));
vi.mock('@/src/lib/repositories', () => ({
  repositories: { company: dal, contact: dal, incident: dal, meeting: dal, project: dal },
}));

import { ShellChrome } from '@/App';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

describe('ShellChrome cold mount (AC-OVERFETCH-001)', () => {
  it('fires no list DAL call while the palette is closed', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/projects/p1']}>
          <ImpersonationProvider realRole="Admin">
            <ToastProvider>
              <ShellChrome />
            </ToastProvider>
          </ImpersonationProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await new Promise((r) => setTimeout(r, 50));
    for (const fn of [dal.listProjects, dal.listProcurements, dal.getSalesPipeline, dal.list]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });
});
