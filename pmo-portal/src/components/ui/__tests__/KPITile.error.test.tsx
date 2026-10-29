import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { KPITile } from '../KPITile';

/**
 * W2-4a — KPITile error prop.
 * AC-MONEY-DISPLAY: KPITile omits unknown money when `error` is set, not the value or a dash.
 */
describe('KPITile — error prop (AC-W2-4-03)', () => {
  it('AC-MONEY-DISPLAY: omits the figure when error=true, not the value, a dash, or the skeleton', () => {
    render(
      <MemoryRouter>
        <KPITile
          icon="dollar"
          tone="blue"
          label="My projects"
          value="42"
          error
          testId="kpi-test"
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('kpi-test')).not.toHaveTextContent('—');
    expect(screen.queryByText('42')).toBeNull();
    // Should NOT show skeleton
    expect(screen.queryByTestId('kpi-skeleton')).toBeNull();
  });

  it('AC-W2-4-03: without error, still renders the normal value', () => {
    render(
      <MemoryRouter>
        <KPITile
          icon="dollar"
          tone="blue"
          label="My projects"
          value="42"
          testId="kpi-test"
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('kpi-test')).toHaveTextContent('42');
    expect(screen.queryByTestId('kpi-skeleton')).toBeNull();
  });

  it('AC-MONEY-DISPLAY: link variant with error also omits a dash instead of the value', () => {
    render(
      <MemoryRouter>
        <KPITile
          icon="dollar"
          tone="blue"
          label="Awaiting"
          value="5"
          error
          to="/approvals"
          linkLabel="Awaiting: 5 items"
          testId="kpi-link-test"
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('kpi-link-test')).not.toHaveTextContent('—');
    expect(screen.queryByText('5')).toBeNull();
  });
});
