import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWidget } from './registry';

describe('renderWidget registry (FR-ATC-005)', () => {
  it('AC-ATC-005 data_table renders via registry as DataTable', () => {
    render(
      <MemoryRouter>
        {renderWidget({
          kind: 'data_table',
          columns: [{ key: 'name', label: 'Project' }],
          rows: [{ name: 'Alpha' }],
        })}
      </MemoryRouter>,
    );
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Alpha' })).toBeInTheDocument();
    expect(document.querySelector('pre')).toBeNull();
  });

  it('AC-ATC-006 data_insight renders via registry as KPITile', () => {
    render(
      <MemoryRouter>
        {renderWidget({ kind: 'data_insight', label: 'Over-budget projects', value: 3 })}
      </MemoryRouter>,
    );
    expect(screen.getByText('Over-budget projects')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders a data_chart widget inside a ChartFrame without throwing', () => {
    render(
      <MemoryRouter>
        {renderWidget({
          kind: 'data_chart',
          chartType: 'bar',
          series: [{ label: 'Alpha', value: 3 }],
        })}
      </MemoryRouter>,
    );
    expect(screen.getByRole('img')).toBeInTheDocument();
  });
});
