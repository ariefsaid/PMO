/** AC-FSF-009 — the former-staff filter reads as Bahasa Indonesia under the real `id` catalogue. */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import { BahasaProvider } from '@/test/bahasa';

vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Admin' as Role, effectiveRole: 'Admin' as Role }) }));
vi.mock('@/src/hooks/usePeople', () => ({
  usePeople: (status: string = 'active') => ({
    data: [
      { id: 'p1', code: 'P-0001', name: 'Budi', job_title: null, profile_id: null, archived_at: null },
      ...(status === 'active' ? [] : [{ id: 'p2', code: 'P-0009', name: 'Ayu', job_title: null, profile_id: null, archived_at: '2026-10-01T00:00:00Z' }]),
    ],
    isPending: false, isError: false, refetch: vi.fn(),
  }),
  usePeopleMutations: () => ({ create: { mutateAsync: vi.fn() }, update: { mutateAsync: vi.fn() }, archive: { mutateAsync: vi.fn(), isPending: false } }),
}));
vi.mock('@/src/hooks/useOrgProfilesLoader', () => ({ useOrgProfilesLoader: () => () => Promise.resolve([]) }));

import People from './People';

describe('People former-staff filter in Bahasa (AC-FSF-009)', () => {
  it('has no English-only filter or status strings', async () => {
    const user = userEvent.setup();
    render(<BahasaProvider><MemoryRouter><ToastProvider><People /></ToastProvider></MemoryRouter></BahasaProvider>);
    const group = screen.getByRole('group', { name: 'Status personel' });
    expect(within(group).getByRole('button', { name: 'Aktif' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(group).getByRole('button', { name: 'Mantan personel' }));
    expect(within(screen.getByRole('row', { name: /Ayu/ })).getByText('Mantan personel')).toBeInTheDocument();
    expect(screen.queryByText('Former staff')).toBeNull();
    expect(screen.queryByText('Staff status')).toBeNull();
  });
});
