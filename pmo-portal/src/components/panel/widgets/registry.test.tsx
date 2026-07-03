import { describe, expect, it, vi } from 'vitest';
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

  // ── Item 5 (F1, Discover finding): data_table caption + scroll mask ──────────

  it('item 5 data_table renders widget.caption as a labeled header (ChartFrame idiom)', () => {
    render(
      <MemoryRouter>
        {renderWidget({
          kind: 'data_table',
          columns: [{ key: 'name', label: 'Project' }],
          rows: [{ name: 'Alpha' }],
          caption: 'Active projects',
        })}
      </MemoryRouter>,
    );
    expect(screen.getByText('Active projects')).toBeInTheDocument();
  });

  it('item 5 data_table without a caption renders no header (no empty label)', () => {
    render(
      <MemoryRouter>
        {renderWidget({
          kind: 'data_table',
          columns: [{ key: 'name', label: 'Project' }],
          rows: [{ name: 'Alpha' }],
        })}
      </MemoryRouter>,
    );
    // No caption supplied — the table renders without a labeled header element.
    expect(screen.queryByTestId('data-table-widget-caption')).toBeNull();
  });

  it('item 5 data_table renders the scroll-mask affordance when content overflows (scrollWidth>clientWidth)', () => {
    // jsdom never computes real layout — force the overflow condition the
    // component's effect checks so the RED/GREEN proof is real, not vacuous.
    const scrollWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
      .mockReturnValue(600);
    const clientWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockReturnValue(300);

    render(
      <MemoryRouter>
        {renderWidget({
          kind: 'data_table',
          columns: [{ key: 'name', label: 'Project' }],
          rows: [{ name: 'Alpha' }],
          caption: 'Wide data',
        })}
      </MemoryRouter>,
    );

    expect(screen.getByTestId('data-table-widget-scroll-mask')).toBeInTheDocument();

    scrollWidthSpy.mockRestore();
    clientWidthSpy.mockRestore();
  });

  it('item 5 data_table renders NO scroll-mask affordance when content fits (scrollWidth<=clientWidth)', () => {
    const scrollWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
      .mockReturnValue(300);
    const clientWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockReturnValue(300);

    render(
      <MemoryRouter>
        {renderWidget({
          kind: 'data_table',
          columns: [{ key: 'name', label: 'Project' }],
          rows: [{ name: 'Alpha' }],
          caption: 'Narrow data',
        })}
      </MemoryRouter>,
    );

    expect(screen.queryByTestId('data-table-widget-scroll-mask')).toBeNull();

    scrollWidthSpy.mockRestore();
    clientWidthSpy.mockRestore();
  });
});
