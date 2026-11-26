import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { ListPage } from '../ListPage';

describe('ListPage shell', () => {
  it('renders the canonical header row: title + count + right-aligned primary action', () => {
    render(
      <ListPage
        title="Companies"
        count={42}
        primaryAction={<button type="button">New company</button>}
      />,
    );
    expect(screen.getByRole('heading', { name: /Companies/ })).toBeInTheDocument();
    // count chip rides with the title
    expect(screen.getByTestId('list-page-count')).toHaveTextContent(/^42$/);
    // the primary action lives in the header (top-right), not the toolbar
    const header = screen.getByTestId('list-page-header');
    expect(within(header).getByRole('button', { name: 'New company' })).toBeInTheDocument();
  });

  it('renders an embedded title as an h2 without adding a page-level heading', () => {
    render(<ListPage title="Invoices" headingLevel={2} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Invoices' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });

  it('groups search, status/filter controls, and view/actions for a stable responsive toolbar', () => {
    render(
      <ListPage
        title="Companies"
        view={<div data-testid="slot-view">view</div>}
        filters={<div data-testid="slot-filters">filters</div>}
        search={<div data-testid="slot-search">search</div>}
        secondaryFilter={<div data-testid="slot-secondary">secondary</div>}
        exportAction={<div data-testid="slot-export">export</div>}
        importAction={<div data-testid="slot-import">import</div>}
      >
        body
      </ListPage>,
    );
    const toolbar = screen.getByTestId('list-page-toolbar');
    expect(within(toolbar).getByTestId('list-page-search-group')).toContainElement(screen.getByTestId('slot-search'));
    expect(within(toolbar).getByTestId('list-page-filter-group')).toContainElement(screen.getByTestId('slot-filters'));
    expect(within(toolbar).getByTestId('list-page-filter-group')).toContainElement(screen.getByTestId('slot-secondary'));
    expect(within(toolbar).getByTestId('list-page-action-group')).toContainElement(screen.getByTestId('slot-view'));
    expect(within(toolbar).getByTestId('list-page-action-group')).toContainElement(screen.getByTestId('slot-export'));
    expect(within(toolbar).getByTestId('list-page-action-group')).toContainElement(screen.getByTestId('slot-import'));
  });

  it('phone users can open the filter sheet and still filter, export and import', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    const onFilter = vi.fn();
    const onExport = vi.fn();
    try {
      render(<ListPage title="Companies" search={<input aria-label="Search companies" />} filters={<button onClick={onFilter}>Suppliers</button>} exportAction={<button onClick={onExport}>Export companies</button>} importAction={<button>Import companies</button>} />);
      expect(screen.getByRole('textbox', { name: 'Search companies' })).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Suppliers' })).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Filters' }));
      const sheet = await screen.findByRole('dialog', { name: 'Filters' });
      await userEvent.click(within(sheet).getByRole('button', { name: 'Suppliers' }));
      expect(onFilter).toHaveBeenCalledOnce();
      await userEvent.click(within(sheet).getByRole('button', { name: 'Export companies' }));
      expect(onExport).toHaveBeenCalledOnce();
      expect(within(sheet).getByRole('button', { name: 'Import companies' })).toBeVisible();
      await userEvent.keyboard('{Escape}');
      await screen.findByRole('textbox', { name: 'Search companies' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('pushes the view-switcher to the right edge of the toolbar', () => {
    render(
      <ListPage title="Projects" view={<div data-testid="slot-view">view</div>}>
        body
      </ListPage>,
    );
    // the view slot is grouped with trailing actions and stays right-aligned on desktop
    const viewWrap = screen.getByTestId('list-page-view');
    expect(viewWrap.parentElement).toHaveAttribute('data-testid', 'list-page-action-group');
  });

  it('omits the toolbar entirely when no toolbar slots are supplied', () => {
    render(
      <ListPage title="Empty" primaryAction={<button type="button">New</button>}>
        body
      </ListPage>,
    );
    expect(screen.queryByTestId('list-page-toolbar')).not.toBeInTheDocument();
  });

  it('renders the body content and an optional banner above the toolbar', () => {
    render(
      <ListPage
        title="Companies"
        banner={<div data-testid="slot-banner">blocked</div>}
        search={<div data-testid="slot-search">search</div>}
      >
        <div data-testid="list-body">rows</div>
      </ListPage>,
    );
    expect(screen.getByTestId('slot-banner')).toBeInTheDocument();
    expect(screen.getByTestId('list-body')).toBeInTheDocument();
  });

  it('renders count chip as "Showing {count} of {total}" when count < total', () => {
    render(
      <ListPage
        title="Companies"
        count={5}
        total={20}
      />,
    );
    expect(screen.getByTestId('list-page-count')).toHaveTextContent('Showing 5 of 20');
  });

  it('#1791: shows "Showing x of y" even when count equals total, and a bare count when total is undefined', () => {
    const { rerender } = render(
      <ListPage
        title="Companies"
        count={20}
        total={20}
      />,
    );
    expect(screen.getByTestId('list-page-count')).toHaveTextContent('Showing 20 of 20');

    rerender(
      <ListPage
        title="Companies"
        count={42}
      />,
    );
    expect(screen.getByTestId('list-page-count')).toHaveTextContent('42');
  });
});
