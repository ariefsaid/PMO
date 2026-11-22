/** AC-CLR-010 — the clearance screens read as Bahasa Indonesia under the real `id` catalogue. */
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/src/components/ui';
import { BahasaProvider } from '@/test/bahasa';

vi.mock('@/src/lib/repositories/clearance', () => ({
  clearanceRepository: {
    enabled: vi.fn().mockResolvedValue(true), items: vi.fn().mockResolvedValue([]), summary: vi.fn().mockResolvedValue([]),
    due: vi.fn().mockResolvedValue([]),
    checklist: vi.fn().mockResolvedValue([{ item_id: 'i1', name: 'X', is_required: true, sort_order: 1, done_on: null, expires_on: null, note: null, state: 'missing' }]),
  },
}));
vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    people: { list: vi.fn().mockResolvedValue([]) },
    documentExpiry: { getPerson: vi.fn().mockResolvedValue({ id: 'p1', name: 'Test Person', code: 'P-1' }) },
  },
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true, CanWrite: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'o' } }) }));

import Clearance from './Clearance';
import PersonClearance from './PersonClearance';

const wrap = (ui: React.ReactNode, path = '/') => render(
  <BahasaProvider><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider><MemoryRouter initialEntries={[path]}><Routes><Route path="/administration/clearance/:personId" element={ui} /><Route path="*" element={ui} /></Routes></MemoryRouter></ToastProvider></QueryClientProvider></BahasaProvider>,
);

describe('Clearance in Bahasa', () => {
  it('translates the section', async () => {
    wrap(<Clearance />);
    expect(await screen.findByText('Belum ada butir daftar periksa')).toBeInTheDocument();
    expect(screen.getByText('Tambah butir')).toBeInTheDocument();
  });
  it('translates the person checklist', async () => {
    wrap(<PersonClearance />, '/administration/clearance/p1');
    expect(await screen.findByText('Belum selesai')).toBeInTheDocument();
  });
});
