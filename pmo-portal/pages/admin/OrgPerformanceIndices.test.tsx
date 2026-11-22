import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import { bandsValid } from '@/src/lib/workOrderPerformance';

const h = vi.hoisted(() => ({ settings: { data: undefined as unknown, isError: false, refetch: vi.fn() }, save: vi.fn(), canManage: true }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => (a: string, e: string) => h.canManage && a === 'manage' && e === 'orgPerformanceIndices' }));
vi.mock('@/src/hooks/useWorkOrderPerformance', () => ({
  usePerformanceSettings: () => h.settings,
  useSavePerformanceSettings: () => ({ mutateAsync: h.save, isPending: false }),
}));
import OrgPerformanceIndices from './OrgPerformanceIndices';

const renderCard = () => render(
  <QueryClientProvider client={new QueryClient()}><AuthContext.Provider value={{ currentUser: { org_id: 'org-1' } } as never}><ToastProvider><OrgPerformanceIndices /></ToastProvider></AuthContext.Provider></QueryClientProvider>,
);

beforeEach(() => {
  h.settings = { data: { enabled: true, bands: { low: '0.90', high: '1.10' } }, isError: false, refetch: vi.fn() };
  h.save.mockReset(); h.save.mockResolvedValue(undefined); h.canManage = true;
});
afterEach(cleanup);

describe('AC-CSP-020 band validation', () => {
  it('accepts 0 < low < 1 < high only', () => {
    expect(bandsValid(0.9, 1.1)).toBe(true);
    expect(bandsValid(1, 1.1)).toBe(false);
    expect(bandsValid(0, 1.1)).toBe(false);
    expect(bandsValid(0.9, 1)).toBe(false);
    expect(bandsValid(null, 1.1)).toBe(false);
  });
});

describe('OrgPerformanceIndices', () => {
  it('shows the defaults, offers no switch (the panels are on for everyone, #2746), and saves the bands', async () => {
    renderCard();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect((screen.getByLabelText(/Lower limit/) as HTMLInputElement).value).toBe('0.90');
    expect((screen.getByLabelText(/Upper limit/) as HTMLInputElement).value).toBe('1.10');
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Lower limit/), { target: { value: '0.8' } });
    fireEvent.change(screen.getByLabelText(/Upper limit/), { target: { value: '1,25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.save).toHaveBeenCalledWith({ enabled: true, low: 0.8, high: 1.25 }));
  });
  it('will not save an invalid band', () => {
    renderCard();
    fireEvent.change(screen.getByLabelText(/Lower limit/), { target: { value: '1.2' } });
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('is read-only for a role that cannot manage it', () => {
    h.canManage = false;
    renderCard();
    expect(screen.getByTestId('org-performance-indices-readonly').textContent).toContain('Only an Admin can change this.');
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});
