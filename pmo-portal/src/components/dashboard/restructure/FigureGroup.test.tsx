import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { FigureGroup } from './FigureGroup';
import type { DashboardFigure } from './FigureGroup';

const figures: DashboardFigure[] = [
  { id: 'contract', label: 'Contract on hand', value: 'USD 2.4M', subline: 'USD 1.2M left after spending', href: '/projects' },
  { id: 'margin', label: 'Margin on billed work', value: null, unavailableReason: 'Billed-work margin could not be calculated.' },
];

const renderGroup = (props: Partial<React.ComponentProps<typeof FigureGroup>> = {}) => render(
  <MemoryRouter><FigureGroup heading="Today" figures={figures} {...props} /></MemoryRouter>,
);

describe('FigureGroup', () => {
  it('renders figure destinations as links and explains unknown values', () => {
    renderGroup();

    expect(screen.getByRole('heading', { name: 'Today' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Contract on hand.*USD 2\.4M/i })).toHaveAttribute('href', '/projects');
    const unknown = screen.getByText('—');
    expect(unknown).toHaveAttribute('title', 'Billed-work margin could not be calculated.');
    expect(unknown.querySelector('.sr-only')).toHaveTextContent('Billed-work margin could not be calculated.');
  });

  it('keeps loading and error states inside this group only', () => {
    const { rerender } = renderGroup({ isPending: true });
    expect(screen.getByTestId('figure-group-loading')).toHaveAttribute('aria-busy', 'true');

    const retry = vi.fn();
    rerender(<MemoryRouter><FigureGroup heading="Today" figures={figures} isError onRetry={retry} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('L2: a multi-currency figure puts each currency on its own line, never wrapped mid-pair', () => {
    renderGroup({ figures: [{ id: 'invoiced', label: 'Invoiced', value: 'IDR 114.7M · $11.8M', lines: ['IDR 114.7M', '$11.8M'] }] });
    expect(screen.getByText('IDR 114.7M')).toHaveClass('block');
    expect(screen.getByText('$11.8M')).toHaveClass('block');
    expect(screen.queryByText('IDR 114.7M · $11.8M')).not.toBeInTheDocument();
  });

  it('O15: a single figure spans the group instead of sitting in a half-width column', () => {
    renderGroup({ figures: [{ id: 'won', label: 'Won', value: '3 · $14.4M' }] });
    const cell = screen.getByText('3 · $14.4M').closest('.border-b') as HTMLElement;
    expect(cell.parentElement).toHaveClass('grid-cols-1');
  });
});
