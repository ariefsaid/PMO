import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProgressBar } from '../ProgressBar';

describe('ProgressBar', () => {
  it('exposes progressbar role + aria values', () => {
    render(<ProgressBar value={62} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '62');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });

  it('fill width equals the percent', () => {
    render(<ProgressBar value={62} />);
    const fill = screen.getByTestId('progress-fill');
    expect(fill.style.width).toBe('62%');
  });

  it('threshold tone: >=70 success, >=40 warning, else destructive', () => {
    const { rerender } = render(<ProgressBar value={80} />);
    expect(screen.getByTestId('progress-fill').className).toContain('bg-success');
    rerender(<ProgressBar value={50} />);
    expect(screen.getByTestId('progress-fill').className).toContain('bg-warning');
    rerender(<ProgressBar value={20} />);
    expect(screen.getByTestId('progress-fill').className).toContain('bg-destructive');
  });

  it('clamps >100 and fills destructive (over-budget signal)', () => {
    render(<ProgressBar value={140} />);
    const fill = screen.getByTestId('progress-fill');
    expect(fill.style.width).toBe('100%');
    expect(fill.className).toContain('bg-destructive');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '140');
  });

  it('renders a trailing tabular value when showValue', () => {
    render(<ProgressBar value={62} showValue />);
    const v = screen.getByText('62%');
    expect(v.className).toContain('tabular');
  });
});
