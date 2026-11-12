import { fireEvent, render, screen, within } from '@testing-library/react';
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
  return <><FilterBar filters={filters} searchKey="q" searchLabel="Search records" values={state.values} onChange={state.setFilter} onClear={state.clear} shown={2} total={5} />
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
  it('collapses into a filters sheet on phones', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    setup();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search records' })).toBeInTheDocument();
  });
  it('R2: the phone Filters trigger carries the number of filters in force, and no badge at rest', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    setup('/?q=bridge&status=open&project=one');
    const trigger = screen.getByRole('button', { name: /^Filters/ });
    // The search box is not a filter: two selects/segments are in force, the typed query is not counted.
    expect(within(trigger).getByTestId('filter-bar-count')).toHaveTextContent('2');
  });
  it('R2: nothing in force means no badge, so the trigger reads plainly as Filters', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    setup('/?other=keep');
    expect(screen.getByRole('button', { name: 'Filters' })).not.toHaveTextContent(/\d/);
  });
  it('has no accessibility violations', async () => {
    const { container } = setup();
    expect(await axe(container)).toHaveNoViolations();
  });
});
