import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { KPITile } from '../KPITile';

/**
 * W2-4a — KPITile error prop.
 * AC-W2-4-03: KPITile renders "—" when `error` is set, not the value, and not the skeleton.
 */
describe('KPITile — error prop (AC-W2-4-03)', () => {
  it('AC-W2-4-03: renders "—" when error=true, not the value or skeleton', () => {
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

    // Should show em-dash, not the real value
    expect(screen.getByTestId('kpi-test')).toHaveTextContent('—');
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

  it('AC-W2-4-03: link variant with error renders "—" instead of value', () => {
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
    expect(screen.getByTestId('kpi-link-test')).toHaveTextContent('—');
    expect(screen.queryByText('5')).toBeNull();
  });
});
