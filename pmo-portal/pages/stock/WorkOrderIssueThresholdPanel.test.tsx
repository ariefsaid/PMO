import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const h = vi.hoisted(() => ({ threshold: vi.fn(), setThreshold: vi.fn() }));
vi.mock('@/src/lib/repositories/workOrderMaterialProgress', () => ({ workOrderMaterialProgressRepository: { threshold: h.threshold, setThreshold: h.setThreshold } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }) }));
vi.mock('@/src/components/stock/useStockErrorText', () => ({ useStockErrorText: () => () => '' }));

import { WorkOrderIssueThresholdPanel } from './WorkOrderIssueThresholdPanel';
import { parseThreshold } from '@/src/lib/workOrderIssueThreshold';

const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><WorkOrderIssueThresholdPanel /></QueryClientProvider>);
beforeEach(() => { h.threshold.mockReset(); h.setThreshold.mockReset(); h.threshold.mockResolvedValue(null); h.setThreshold.mockResolvedValue(20); });

describe('parseThreshold', () => {
  it('AC-MIP-015 empty clears, 0 to 100 with at most two decimals passes, anything else is refused', () => {
    expect(parseThreshold('')).toEqual({ ok: true, value: null });
    expect(parseThreshold('0')).toEqual({ ok: true, value: 0 });
    expect(parseThreshold('12,5')).toEqual({ ok: true, value: 12.5 });
    expect(parseThreshold('100')).toEqual({ ok: true, value: 100 });
    for (const bad of ['101', '-1', 'abc', '1.234', '1e2']) expect(parseThreshold(bad)).toEqual({ ok: false });
  });
});

describe('WorkOrderIssueThresholdPanel', () => {
  it('AC-MIP-015 saving 20 sends 20', async () => {
    mount();
    const input = await screen.findByLabelText(/siteWork\.materialProgress\.setting\.label/);
    await waitFor(() => expect((input as HTMLInputElement).disabled).toBe(false));
    fireEvent.change(input, { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'siteWork.materialProgress.setting.save' }));
    await waitFor(() => expect(h.setThreshold).toHaveBeenCalledWith(20));
  });

  it('AC-MIP-015 an out-of-range figure shows a field error and does not save', async () => {
    mount();
    const input = await screen.findByLabelText(/siteWork\.materialProgress\.setting\.label/);
    await waitFor(() => expect((input as HTMLInputElement).disabled).toBe(false));
    fireEvent.change(input, { target: { value: '101' } });
    expect(screen.getAllByText('siteWork.materialProgress.setting.range').length).toBeGreaterThan(0);
    expect((screen.getByRole('button', { name: 'siteWork.materialProgress.setting.save' }) as HTMLButtonElement).disabled).toBe(true);
    expect(h.setThreshold).not.toHaveBeenCalled();
  });

  it('AC-MIP-015 emptying the field and saving clears the threshold', async () => {
    h.threshold.mockResolvedValue(20);
    mount();
    const input = await screen.findByDisplayValue('20');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'siteWork.materialProgress.setting.save' }));
    await waitFor(() => expect(h.setThreshold).toHaveBeenCalledWith(null));
  });
});
