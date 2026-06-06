import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KPITile } from '../KPITile';

describe('KPITile', () => {
  it('renders label + tabular value', () => {
    render(<KPITile icon="dollar" tone="blue" label="Pipeline value" value="$4.2M" />);
    expect(screen.getByText('Pipeline value')).toBeInTheDocument();
    const v = screen.getByText('$4.2M');
    expect(v.className).toContain('tabular');
  });

  it('negative value turns destructive', () => {
    render(<KPITile icon="dollar" tone="red" label="Margin" value="-$120K" negative />);
    expect(screen.getByText('-$120K').className).toContain('text-destructive');
  });

  it('delta direction maps to the right chip tone', () => {
    const { rerender } = render(
      <KPITile icon="up" tone="green" label="x" value="1" delta={{ dir: 'up', text: '+12%' }} />
    );
    expect(screen.getByTestId('kpi-delta').className).toContain('text-success');
    rerender(
      <KPITile icon="down" tone="red" label="x" value="1" delta={{ dir: 'down', text: '-4%' }} />
    );
    expect(screen.getByTestId('kpi-delta').className).toContain('text-destructive');
  });

  it('help is keyboard-focusable with an aria-label', () => {
    render(<KPITile icon="dollar" tone="blue" label="x" value="1" help="Weighted by stage" />);
    const help = screen.getByLabelText(/help/i);
    expect(help).toHaveAttribute('tabindex', '0');
  });

  it('loading renders a skeleton tile', () => {
    render(<KPITile icon="dollar" tone="blue" label="x" value="" loading />);
    expect(screen.getByTestId('kpi-skeleton')).toBeInTheDocument();
  });

  it('dual-lens toggle switches value + aria-selected', async () => {
    const onLens = vi.fn();
    render(
      <KPITile
        icon="dollar"
        tone="blue"
        label="Backlog"
        value="$4.2M"
        dual={{ lens: 'onhand', onLens, options: [
          { value: 'onhand', label: 'On hand' },
          { value: 'weighted', label: 'Weighted' },
        ] }}
      />
    );
    const weighted = screen.getByRole('tab', { name: 'Weighted' });
    expect(screen.getByRole('tab', { name: 'On hand' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(weighted);
    expect(onLens).toHaveBeenCalledWith('weighted');
  });
});
