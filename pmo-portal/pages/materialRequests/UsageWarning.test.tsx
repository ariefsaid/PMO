import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({ set: vi.fn(), reload: vi.fn(), th: { pct1: 80, pct2: 100 } as { pct1: number | null; pct2: number | null } | null }));
vi.mock('@/src/lib/repositories/materialRequests', async (orig) => {
  const real = await orig<typeof import('@/src/lib/repositories/materialRequests')>();
  return { ...real, materialRequestRepository: { ...real.materialRequestRepository, setUsageThresholds: h.set } };
});
vi.mock('@/src/hooks/useUsageThresholds', () => ({ useUsageThresholds: () => ({ thresholds: h.th, reload: h.reload }) }));

import { UsageWarning } from './UsageWarning';
import { UsageThresholdsEditor } from './UsageThresholdsEditor';

describe('AC-MUT-009 the usage warning on a line', () => {
  it('names the percent reached and the threshold, and is not a blocking element', () => {
    render(<UsageWarning line={{ planQty: 100, priorQty: 60, quantity: 25 }} thresholds={{ pct1: 80, pct2: 100 }} />);
    const w = screen.getByTestId('mrq-usage-warning');
    expect(w).toHaveTextContent('Use reaches 85% of plan, past the 80% warning.');
    expect(w).not.toHaveAttribute('aria-live', 'assertive');
  });
  it('says so when no plan is set', () => {
    render(<UsageWarning line={{ planQty: 0, priorQty: 0, quantity: 3 }} thresholds={{ pct1: 80, pct2: null }} />);
    expect(screen.getByTestId('mrq-usage-warning')).toHaveTextContent('No plan is set, so any use is past the 80% warning.');
  });
  it('renders nothing with thresholds unset or use below them', () => {
    const { container, rerender } = render(<UsageWarning line={{ planQty: 100, priorQty: 90, quantity: 50 }} thresholds={{ pct1: null, pct2: null }} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<UsageWarning line={{ planQty: 100, priorQty: 0, quantity: 10 }} thresholds={{ pct1: 80, pct2: 100 }} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<UsageWarning line={{ planQty: 100, priorQty: 90, quantity: 50 }} thresholds={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('AC-MUT-008 the thresholds editor', () => {
  it('shows the stored values and saves a valid pair', async () => {
    h.th = { pct1: 80, pct2: 100 };
    h.set.mockResolvedValue(undefined);
    render(<ToastProvider><UsageThresholdsEditor /></ToastProvider>);
    expect(screen.getByLabelText('First warning (% of plan)')).toHaveValue('80');
    await userEvent.clear(screen.getByLabelText('Second warning (% of plan)'));
    await userEvent.type(screen.getByLabelText('Second warning (% of plan)'), '120');
    await userEvent.click(screen.getByRole('button', { name: 'Save warnings' }));
    expect(h.set).toHaveBeenCalledWith({ pct1: 80, pct2: 120 });
  });
  it('refuses a second threshold not above the first, and zero, without calling the server', async () => {
    h.th = { pct1: null, pct2: null };
    h.set.mockClear();
    render(<ToastProvider><UsageThresholdsEditor /></ToastProvider>);
    await userEvent.type(screen.getByLabelText('First warning (% of plan)'), '90');
    await userEvent.type(screen.getByLabelText('Second warning (% of plan)'), '90');
    expect(screen.getByText('The second warning must be higher than the first.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save warnings' })).toBeDisabled();
    await userEvent.clear(screen.getByLabelText('First warning (% of plan)'));
    await userEvent.type(screen.getByLabelText('First warning (% of plan)'), '0');
    expect(screen.getAllByText('Enter a percentage from 1 to 1000.').length).toBeGreaterThan(0);
    expect(h.set).not.toHaveBeenCalled();
  });
  it('clearing both fields saves null, which switches the warnings off', async () => {
    h.th = { pct1: 80, pct2: 100 };
    h.set.mockResolvedValue(undefined);
    render(<ToastProvider><UsageThresholdsEditor /></ToastProvider>);
    await userEvent.clear(screen.getByLabelText('First warning (% of plan)'));
    await userEvent.clear(screen.getByLabelText('Second warning (% of plan)'));
    await userEvent.click(screen.getByRole('button', { name: 'Save warnings' }));
    expect(h.set).toHaveBeenCalledWith({ pct1: null, pct2: null });
  });
});

