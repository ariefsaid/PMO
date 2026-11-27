import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { AuthContext, type AuthContextValue } from '@/src/auth/AuthContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Who may set the manager and the deputy (guard_project_people_fields, 2751): the form shows only what the database accepts.
vi.mock('@/src/lib/repositories', () => ({ repositories: { project: { proposeNumber: vi.fn().mockResolvedValue('RIS-26-0001') } } }));
vi.mock('@/src/hooks/useProjects', () => ({
  useClientCompanies: () => ({ data: [{ id: 'client-1', name: 'Acme Client', type: 'Client' }], isError: false }),
  useProjectManagers: () => ({ data: [{ id: 'me', full_name: 'Me Manager' }, { id: 'other', full_name: 'Other Manager' }], isError: false }),
}));
vi.mock('@/src/hooks/useProjectClassificationOptions', () => ({ useProjectClassificationOptions: () => ({ data: { serviceLines: [], sectors: [] }, isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useCompanies', () => ({ useCompanies: () => ({ data: [], isError: false }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));

import ProjectFormModal, { type ProjectFormInitial } from './ProjectFormModal';

const signedIn = (role: string, builtInRole: string | null) =>
  ({ role, currentUser: { id: 'me', role, built_in_role: builtInRole } }) as unknown as AuthContextValue;
const project = (managerId: string): ProjectFormInitial =>
  ({ id: 'p1', name: 'Site', code: null, client_id: 'client-1', clientName: 'Acme Client', project_manager_id: managerId, deputy_manager_id: null }) as ProjectFormInitial;

function renderAs(auth: AuthContextValue, initial?: ProjectFormInitial) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthContext.Provider value={auth}>
        <ToastProvider>
          <ProjectFormModal mode={initial ? 'editHeader' : 'create'} initial={initial} onClose={vi.fn()} onSubmit={vi.fn()} onSave={vi.fn()} onError={vi.fn()} />
        </ToastProvider>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}
const field = (name: RegExp) => screen.queryByRole('combobox', { name });

afterEach(() => cleanup());

describe('ProjectFormModal people fields', () => {
  it('a Project Manager editing a project they manage names the deputy but does not change the manager', () => {
    renderAs(signedIn('Project Manager', 'project_manager'), project('me'));
    expect(field(/deputy manager/i)).not.toBeNull();
    expect(field(/^project manager/i)).toBeNull();
  });

  it('a Project Manager editing another manager\'s project sets neither field', () => {
    renderAs(signedIn('Project Manager', 'deputy_project_manager'), project('other'));
    expect(field(/deputy manager/i)).toBeNull();
    expect(field(/^project manager/i)).toBeNull();
  });

  it('a Project Manager creating a project names the manager; the deputy waits until they name themselves', () => {
    renderAs(signedIn('Project Manager', null));
    expect(field(/^project manager/i)).not.toBeNull();
    expect(field(/deputy manager/i)).toBeNull();
  });

  it('a Procurement Manager and an Admin set both fields on any project', () => {
    renderAs(signedIn('Project Manager', 'procurement_manager'), project('other'));
    expect(field(/deputy manager/i)).not.toBeNull();
    expect(field(/^project manager/i)).not.toBeNull();
    cleanup();
    renderAs(signedIn('Admin', null), project('other'));
    expect(field(/deputy manager/i)).not.toBeNull();
    expect(field(/^project manager/i)).not.toBeNull();
  });
});
