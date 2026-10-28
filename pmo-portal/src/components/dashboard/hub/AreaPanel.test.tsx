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
});
