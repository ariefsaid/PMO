import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BahasaProvider } from '@/test/bahasa';

const state = vi.hoisted(() => ({ data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() }));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => state }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'reviewer' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Admin' }) }));
vi.mock('../ProcurementApprovalRow', () => ({ ProcurementApprovalRow: () => <div>row</div> }));
import { ProcurementApprovalSection } from '../ProcurementApprovalSection';

describe('procurement approvals section', () => {
  it('localizes the count and confirmed empty state', () => {
    state.isError = false;
    render(<BahasaProvider><ProcurementApprovalSection /></BahasaProvider>);
    expect(screen.getByText('Pengadaan menunggu Anda (0)')).toBeInTheDocument();
    expect(screen.getByText('Tidak ada pengadaan yang menunggu keputusan Anda')).toBeInTheDocument();
  });
  it('localizes the error and retries the read', async () => {
    state.isError = true;
    render(<BahasaProvider><ProcurementApprovalSection /></BahasaProvider>);
    expect(screen.getByText('Pengadaan gagal dimuat')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /coba lagi/i }));
    expect(state.refetch).toHaveBeenCalled();
  });
});
