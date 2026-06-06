import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ListState } from '../ListState';

describe('ListState', () => {
  it('loading: renders skeleton rows + aria-busy', () => {
    render(<ListState variant="loading" />);
    const region = screen.getByTestId('liststate-loading');
    expect(region).toHaveAttribute('aria-busy', 'true');
    expect(region.querySelectorAll('.skel').length).toBeGreaterThan(0);
  });

  it('empty: renders icon tile, title, sub, and the populating action', async () => {
    const onAction = vi.fn();
    render(
      <ListState
        variant="empty"
        title="No projects yet"
        sub="Create your first project to get started."
        action={{ label: 'New project', onClick: onAction }}
      />
    );
    expect(screen.getByText('No projects yet')).toBeInTheDocument();
    expect(screen.getByText('Create your first project to get started.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'New project' }));
    expect(onAction).toHaveBeenCalled();
  });

  it('error: role=alert, destructive title, and a Retry that calls onRetry', async () => {
    const onRetry = vi.fn();
    render(
      <ListState
        variant="error"
        title="Could not load projects"
        sub="Check your connection and try again."
        onRetry={onRetry}
      />
    );
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(screen.getByText('Could not load projects')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });
});
