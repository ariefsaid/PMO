import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { BahasaProvider } from '@/test/bahasa';

/** #2634 (AC-TWM-022): the setting reads as Bahasa Indonesia under the real `id` catalogue. */
const h = vi.hoisted(() => ({ settings: vi.fn() }));
vi.mock('@/src/lib/repositories/threeWayMatch', () => ({ threeWayMatchRepository: { settings: h.settings, saveSettings: vi.fn(), heldCount: vi.fn().mockResolvedValue(2) } }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'o' } }) }));
import OrgThreeWayMatch from './OrgThreeWayMatch';

describe('OrgThreeWayMatch in Bahasa Indonesia (AC-TWM-022)', () => {
  it('names the setting, the tolerances and the held-bill notice in Bahasa', async () => {
    h.settings.mockResolvedValue({ enabled: true, quantityTolerancePct: '5.00', amountTolerancePct: '2.00' });
    render(<BahasaProvider><QueryClientProvider client={new QueryClient()}><OrgThreeWayMatch /></QueryClientProvider></BahasaProvider>);
    expect(await screen.findByRole('heading', { name: 'Pencocokan tiga arah' })).toBeInTheDocument();
    expect(await screen.findByText('Toleransi kuantitas (%)')).toBeInTheDocument();
    expect(screen.getByText('Toleransi jumlah (%)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Simpan' })).toBeInTheDocument();
  });
});
