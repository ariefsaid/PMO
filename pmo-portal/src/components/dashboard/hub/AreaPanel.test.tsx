import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AreaPanel } from './AreaPanel';

describe('AreaPanel', () => {
  it('links its heading action to the full area page', () => {
    render(
      <MemoryRouter>
        <AreaPanel title="Delivery" openHref="/projects" openLabel="Open projects" meta="Position as of today">
          <p>Project summaries</p>
        </AreaPanel>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Delivery' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open projects' })).toHaveAttribute('href', '/projects');
    expect(screen.getByText('Position as of today')).toBeInTheDocument();
    expect(screen.getByText('Project summaries')).toBeInTheDocument();
  });

  it('O13: the panel body can shrink below its content, so a long truncating row stays inside the card on a phone', () => {
    render(
      <MemoryRouter>
        <AreaPanel title="Tasks" openHref="/my-tasks" openLabel="Open My Tasks">
          <p>A very long task name that must truncate</p>
        </AreaPanel>
      </MemoryRouter>,
    );
    const body = screen.getByText('A very long task name that must truncate').parentElement as HTMLElement;
    expect(body).toHaveClass('min-w-0');
    expect(body.parentElement).toHaveClass('min-w-0');
  });
});
