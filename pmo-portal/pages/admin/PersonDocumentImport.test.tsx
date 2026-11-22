import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PersonDocumentImport } from './PersonDocumentImport';

/** AC-PDI-010 — the document import is shown by the same rule that lets a person add a non-medical person document. */
const may = vi.fn();
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => may }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Admin', effectiveRole: 'Admin' }) }));
vi.mock('@/src/hooks/usePeople', () => ({ usePeople: () => ({ data: [{ id: 'p1', code: 'P-0001', name: 'Ana', job_title: null, profile_id: null, manager_id: null, archived_at: null }] }) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { documentExpiry: { listTypes: vi.fn().mockResolvedValue([]), listPersonDocuments: vi.fn().mockResolvedValue([]) } } }));

const renderIt = () => render(
  <QueryClientProvider client={new QueryClient()}><MemoryRouter><PersonDocumentImport onImported={vi.fn()} /></MemoryRouter></QueryClientProvider>,
);

describe('PersonDocumentImport gate', () => {
  beforeEach(() => may.mockReset());

  it('asks the people-documents rule for a non-medical person document, and shows the button when allowed', () => {
    may.mockReturnValue(true);
    renderIt();
    expect(screen.getByRole('button', { name: 'Import documents' })).toBeInTheDocument();
    expect(may).toHaveBeenCalledWith('create', 'expiryDocument', { record: { kind: 'person', medical: false, viewOnly: false } });
  });

  it('shows nothing to a role that rule refuses', () => {
    may.mockReturnValue(false);
    renderIt();
    expect(screen.queryByRole('button', { name: /import/i })).toBeNull();
  });
});
