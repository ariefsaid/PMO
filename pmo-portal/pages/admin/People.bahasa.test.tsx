/** AC-PPL-011 — the People register reads as Bahasa Indonesia under the real `id` catalogue. */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import { BahasaProvider } from '@/test/bahasa';

vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Admin' as Role, effectiveRole: 'Admin' as Role }) }));
vi.mock('@/src/hooks/usePeople', () => ({
  usePeople: () => ({ data: [{ id: 'p1', code: 'P-0001', name: 'Budi', job_title: null, profile_id: null }], isPending: false, isError: false, refetch: vi.fn() }),
  usePeopleMutations: () => ({ create: { mutateAsync: vi.fn() }, update: { mutateAsync: vi.fn() }, archive: { mutateAsync: vi.fn(), isPending: false } }),
}));
vi.mock('@/src/hooks/useOrgProfilesLoader', () => ({ useOrgProfilesLoader: () => () => Promise.resolve([]) }));
// The document import has its own test (PersonDocumentImport.test.tsx); this file is about the register.
vi.mock('./PersonDocumentImport', () => ({ PersonDocumentImport: () => null }));

import People from './People';

describe('People in Bahasa (AC-PPL-011)', () => {
  it('has no English-only strings on the list', () => {
    render(<BahasaProvider><MemoryRouter><ToastProvider><People /></ToastProvider></MemoryRouter></BahasaProvider>);
    expect(screen.getByRole('button', { name: 'Tambah personel' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Kode personel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Arsipkan Budi/ })).toBeInTheDocument();
    expect(screen.queryByText('Add person')).toBeNull();
  });
});
