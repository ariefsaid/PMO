import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({ set: vi.fn(), refetch: vi.fn().mockResolvedValue(undefined), source: 'site_reports' }));
vi.mock('@/src/lib/repositories/materialRequests', async (orig) => {
  const real = await orig<typeof import('@/src/lib/repositories/materialRequests')>();
  return { ...real, materialRequestRepository: { ...real.materialRequestRepository, setUsageInstalledSource: h.set } };
});
vi.mock('@/src/hooks/useMaterialRequests', () => ({ useUsageInstalledSource: () => ({ data: h.source, refetch: h.refetch }) }));

import { UsageInstalledSourceEditor } from './UsageInstalledSourceEditor';

describe('AC-UW-010 what counts as installed', () => {
  it('shows validated site reports by default and saves the other choice', async () => {
    h.source = 'site_reports';
    h.set.mockResolvedValue(undefined);
    render(<ToastProvider><UsageInstalledSourceEditor /></ToastProvider>);
    const field = screen.getByLabelText('Installed material comes from');
    expect(field).toHaveValue('site_reports');
    expect(screen.getByRole('button', { name: 'Save source' })).toBeDisabled();
    await userEvent.selectOptions(field, 'stock_issues');
    await userEvent.click(screen.getByRole('button', { name: 'Save source' }));
    expect(h.set).toHaveBeenCalledWith('stock_issues');
  });
  it('says what the server refused, in a sentence', async () => {
    h.source = 'site_reports';
    h.set.mockRejectedValue(new Error('MRQ_USAGE_ADMIN_ONLY: only an Admin can change what counts as installed'));
    render(<ToastProvider><UsageInstalledSourceEditor /></ToastProvider>);
    await userEvent.selectOptions(screen.getByLabelText('Installed material comes from'), 'stock_issues');
    await userEvent.click(screen.getByRole('button', { name: 'Save source' }));
    expect(await screen.findByText(/Only an Admin can change the usage warning. Ask an Admin to change it/)).toBeInTheDocument();
  });
});
