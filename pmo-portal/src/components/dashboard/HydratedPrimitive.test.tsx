import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { HydratedPrimitive } from './HydratedPrimitive';
import type { CompiledPanel } from '@/src/lib/viewspec/types';

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
