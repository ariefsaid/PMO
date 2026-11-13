import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { axe } from 'jest-axe';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { FilterBar } from '../FilterBar';
import { useUrlFilters } from '../useUrlFilters';

const filters = [
  { key: 'status', label: 'Status', kind: 'segment' as const, options: [{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }] },
  { key: 'project', label: 'Project', kind: 'select' as const, options: [{ value: 'one', label: 'One' }] },
];
function Example() {
  const state = useUrlFilters(['q', 'status', 'project']);
  const location = useLocation();
  const navigate = useNavigate();
  const total = new URLSearchParams(location.search).get('unknown') === '1' ? undefined : 5;
  return <><FilterBar filters={filters} searchKey="q" searchLabel="Search records" values={state.values} onChange={state.setFilter} onClear={state.clear} shown={2} total={total} />
    <output data-testid="url">{location.search}</output><button onClick={() => navigate(-1)}>Back</button></>;
}
function setup(path = '/?other=keep') { return render(<MemoryRouter initialEntries={[path]}><Example /></MemoryRouter>); }
afterEach(() => vi.unstubAllGlobals());
describe('FilterBar', () => {
  it('updates search, segments and selects in the URL, and clears only its own filters', () => {
    setup();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search records' }), { target: { value: 'bridge' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Project' }), { target: { value: 'one' } });
    expect(screen.getByRole('combobox', { name: 'Project' })).toHaveClass('sm:h-[var(--control-height-sm)]');
    expect(screen.getByTestId('url')).toHaveTextContent('other=keep&q=bridge&status=open&project=one');
    expect(screen.getByText('Showing 2 of 5')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(screen.getByTestId('url')).toHaveTextContent('?other=keep');
    expect(screen.getByRole('button', { name: 'All', pressed: true })).toBeInTheDocument();
  });
  it('restores URL values when navigating back', () => {
    setup('/?status=closed');
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('button', { name: 'Closed', pressed: true })).toBeInTheDocument();
  });
  it('does not show a partial loaded-row count as the total when the total is unknown', () => {
    setup('/?unknown=1');
    expect(screen.queryByText(/Showing 2 of/)).not.toBeInTheDocument();
  });
  it('collapses into a filters sheet on phones', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    setup();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search records' })).toBeInTheDocument();
  });
  it('has no accessibility violations', async () => {
    const { container } = setup();
    expect(await axe(container)).toHaveNoViolations();
  });
});
