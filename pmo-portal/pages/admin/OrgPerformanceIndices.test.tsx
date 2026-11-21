import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ToastProvider } from '@/src/components/ui';
import { bandsValid } from './OrgPerformanceIndices';

const h = vi.hoisted(() => ({ settings: { data: undefined as unknown, isError: false, refetch: vi.fn() }, save: vi.fn(), canManage: true }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => (a: string, e: string) => h.canManage && a === 'manage' && e === 'orgPerformanceIndices' }));
vi.mock('@/src/hooks/useWorkOrderPerformance', () => ({
  usePerformanceSettings: () => h.settings,
  useSavePerformanceSettings: () => ({ mutateAsync: h.save, isPending: false }),
}));
import OrgPerformanceIndices from './OrgPerformanceIndices';

beforeEach(() => {
  h.settings = { data: { enabled: false, bands: { low: '0.90', high: '1.10' } }, isError: false, refetch: vi.fn() };
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
  it('shows the defaults, off, and saves the switch and bands', async () => {
    render(<ToastProvider><OrgPerformanceIndices /></ToastProvider>);
    expect((screen.getByLabelText(/Lower limit/) as HTMLInputElement).value).toBe('0.90');
    expect((screen.getByLabelText(/Upper limit/) as HTMLInputElement).value).toBe('1.10');
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByLabelText(/Lower limit/), { target: { value: '0.8' } });
    fireEvent.change(screen.getByLabelText(/Upper limit/), { target: { value: '1,25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.save).toHaveBeenCalledWith({ enabled: true, low: 0.8, high: 1.25 }));
  });
  it('will not save an invalid band', () => {
    render(<ToastProvider><OrgPerformanceIndices /></ToastProvider>);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByLabelText(/Lower limit/), { target: { value: '1.2' } });
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('is read-only for a role that cannot manage it', () => {
    h.canManage = false;
    render(<ToastProvider><OrgPerformanceIndices /></ToastProvider>);
    expect(screen.getByTestId('org-performance-indices-readonly').textContent).toContain('Only an Admin can change this.');
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});
