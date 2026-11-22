import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({ set: vi.fn(), reload: vi.fn(), th: 80 as number | null }));
vi.mock('@/src/lib/repositories/materialRequests', async (orig) => {
  const real = await orig<typeof import('@/src/lib/repositories/materialRequests')>();
  return { ...real, materialRequestRepository: { ...real.materialRequestRepository, setUsageThreshold: h.set } };
});
vi.mock('@/src/hooks/useUsageThreshold', () => ({ useUsageThreshold: () => ({ threshold: h.th, reload: h.reload }) }));

import { UsageWarning } from './UsageWarning';
import { UsageThresholdsEditor } from './UsageThresholdsEditor';

describe('AC-UW-010 the usage warning on a line', () => {
  it('names installed, plan, the percent reached and the threshold, and is not a blocking element', () => {
    render(<UsageWarning line={{ planQty: 100, installedQty: 85 }} threshold={80} />);
    const w = screen.getByTestId('mrq-usage-warning');
    expect(w).toHaveTextContent('Installed 85 of 100 planned (85%), past the 80% warning. Check the site before more is requested.');
    expect(w).not.toHaveAttribute('aria-live', 'assertive');
  });
  it('says so when no plan is set', () => {
    render(<UsageWarning line={{ planQty: 0, installedQty: 3 }} threshold={80} />);
    expect(screen.getByTestId('mrq-usage-warning')).toHaveTextContent('Installed 3 with no plan set, past the 80% warning.');
  });
  it('renders nothing with the threshold unset or installed below it', () => {
    const { container, rerender } = render(<UsageWarning line={{ planQty: 100, installedQty: 90 }} threshold={null} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<UsageWarning line={{ planQty: 100, installedQty: 10 }} threshold={80} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('AC-UW-011 the threshold editor', () => {
  it('shows the stored value and saves a valid one', async () => {
    h.th = 80;
    h.set.mockResolvedValue(undefined);
    render(<ToastProvider><UsageThresholdsEditor /></ToastProvider>);
    expect(screen.getByLabelText('Warn at (% of plan)')).toHaveValue('80');
    await userEvent.clear(screen.getByLabelText('Warn at (% of plan)'));
    await userEvent.type(screen.getByLabelText('Warn at (% of plan)'), '90');
    await userEvent.click(screen.getByRole('button', { name: 'Save warning' }));
    expect(h.set).toHaveBeenCalledWith(90);
  });
  it('refuses zero without calling the server, and says what to enter', async () => {
    h.th = null;
    h.set.mockClear();
    render(<ToastProvider><UsageThresholdsEditor /></ToastProvider>);
    await userEvent.type(screen.getByLabelText('Warn at (% of plan)'), '0');
    expect(screen.getByText('Enter a percentage from 1 to 1000, or leave it empty to turn the warning off.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save warning' })).toBeDisabled();
    expect(h.set).not.toHaveBeenCalled();
  });
  it('clearing the field saves null, which switches the warning off', async () => {
    h.th = 80;
    h.set.mockResolvedValue(undefined);
    render(<ToastProvider><UsageThresholdsEditor /></ToastProvider>);
    await userEvent.clear(screen.getByLabelText('Warn at (% of plan)'));
    await userEvent.click(screen.getByRole('button', { name: 'Save warning' }));
    expect(h.set).toHaveBeenCalledWith(null);
  });
});
