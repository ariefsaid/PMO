import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { HydratedPrimitive } from './HydratedPrimitive';
import type { CompiledPanel } from '@/src/lib/viewspec/types';
import { setActiveLocale, resetActiveLocale } from '@/src/lib/locale/activeLocale';

const panel = (primitive: string) => ({ id: 'metric', primitive, props: {}, compiledQuery: { entity: 'items', resolvedSelect: ['status', 'value'], resolvedGroupBy: 'status' } }) as unknown as CompiledPanel;

describe('hydrated unknown figures', () => {
  it('F3 omits unknown bars and progress while retaining a known zero', () => {
    const view = render(<MemoryRouter><HydratedPrimitive panel={panel('StatusBarChart')} data={[{ status: 'Unknown', value: null }, { status: 'Known', value: 0 }]} /></MemoryRouter>);
    const table = screen.getByRole('table');
    expect(within(table).queryByText('Unknown')).not.toBeInTheDocument();
    expect(within(table).getByText('Known').closest('tr')).toHaveTextContent('0');
    expect(screen.getByText(/1.*unknown/i)).toBeInTheDocument();
    view.rerender(<MemoryRouter><HydratedPrimitive panel={panel('StatusBarChart')} data={[]} /></MemoryRouter>);
    expect(screen.getByLabelText('Value unknown')).toBeInTheDocument();
    view.rerender(<MemoryRouter><HydratedPrimitive panel={panel('ProgressBar')} data={[{ value: null }]} /></MemoryRouter>);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    view.rerender(<MemoryRouter><HydratedPrimitive panel={panel('ProgressBar')} data={[{ value: 0 }]} /></MemoryRouter>);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });
});

const tablePanel = (primitive: string, cols: string[]) => ({ id: 'built', primitive, props: {}, compiledQuery: { entity: 'projects', resolvedSelect: cols, resolvedGroupBy: cols[0] } }) as unknown as CompiledPanel;

describe('#2089: a built view formats its values in the viewer locale', () => {
  it('formats numbers and dates, humanises headers, keeps codes verbatim (DataTable)', () => {
    setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'UTC' });
    try {
      render(<MemoryRouter><HydratedPrimitive panel={tablePanel('DataTable', ['code', 'contract_value', 'start_date'])} data={[{ id: 'r1', code: '4100', contract_value: 1234567.5, start_date: '2026-06-02' }]} /></MemoryRouter>);
      expect(screen.getAllByRole('columnheader', { name: /contract value/i }).length).toBeGreaterThan(0);
      expect(screen.queryByText('contract_value')).not.toBeInTheDocument();
      expect(screen.getAllByText('1.234.567,5').length).toBeGreaterThan(0);
      expect(screen.queryByText('1234567.5')).not.toBeInTheDocument();
      expect(screen.queryByText('2026-06-02')).not.toBeInTheDocument();
      expect(screen.getAllByText('4100').length).toBeGreaterThan(0);
    } finally {
      resetActiveLocale();
    }
  });

  it('formats StatTiles and Card values the same way', () => {
    setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'UTC' });
    try {
      const view = render(<MemoryRouter><HydratedPrimitive panel={tablePanel('StatTiles', ['status', 'total_value'])} data={[{ status: 'Won', total_value: 2500000 }]} /></MemoryRouter>);
      expect(screen.getByText('2.500.000')).toBeInTheDocument();
      view.rerender(<MemoryRouter><HydratedPrimitive panel={tablePanel('Card', ['total_value'])} data={[{ total_value: 7.5 }]} /></MemoryRouter>);
      expect(screen.getByText('total value')).toBeInTheDocument();
      expect(screen.getByText('7,5')).toBeInTheDocument();
    } finally {
      resetActiveLocale();
    }
  });
});
