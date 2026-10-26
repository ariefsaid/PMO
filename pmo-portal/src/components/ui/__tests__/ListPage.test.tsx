import { render, screen, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ListPage } from '../ListPage';

describe('ListPage shell', () => {
  it('renders the canonical header row: title + count + right-aligned primary action', () => {
    render(
      <ListPage
        title="Companies"
        description="Clients and vendors."
        count={42}
        primaryAction={<button type="button">New company</button>}
      />,
    );
    expect(screen.getByRole('heading', { name: /Companies/ })).toBeInTheDocument();
    expect(screen.getByText('Clients and vendors.')).toBeInTheDocument();
    // count chip rides with the title
    expect(screen.getByTestId('list-page-count')).toHaveTextContent('42');
    // the primary action lives in the header (top-right), not the toolbar
    const header = screen.getByTestId('list-page-header');
    expect(within(header).getByRole('button', { name: 'New company' })).toBeInTheDocument();
  });

  it('puts an opted-in collection primary at the end of its toolbar', () => {
    render(
      <ListPage
        title="Projects"
        search={<input aria-label="Search projects" />}
        primaryAction={<button type="button">New project</button>}
        primaryActionPlacement="toolbar"
      />,
    );
    const toolbar = screen.getByTestId('list-page-toolbar');
    expect(within(screen.getByTestId('list-page-header')).queryByRole('button', { name: 'New project' })).toBeNull();
    expect(within(toolbar).getByTestId('page-primary-action-slot')).toBeInTheDocument();
    expect(within(toolbar).getAllByRole('button').at(-1)).toHaveTextContent('New project');
  });

  it('renders the toolbar slots in the canonical order: filters · search · secondaryFilter · export · import, view right-aligned', () => {
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
    const ids = within(toolbar)
      .getAllByTestId(/^slot-/)
      .map((el) => el.getAttribute('data-testid'));
    // canonical DOM order — filters first, view last (right-aligned)
    expect(ids).toEqual([
      'slot-filters',
      'slot-search',
      'slot-secondary',
      'slot-export',
      'slot-import',
      'slot-view',
    ]);
  });

  it('supports the Projects sequence: search, scope, filters, view, actions, creation', () => {
    render(
      <ListPage
        title="Projects"
        searchFirst
        viewBeforeActions
        search={<div data-testid="slot-search">search</div>}
        filters={<div data-testid="slot-filters">scope</div>}
        secondaryFilter={<div data-testid="slot-secondary">filters</div>}
        view={<div data-testid="slot-view">view</div>}
        exportAction={<div data-testid="slot-export">actions</div>}
        primaryAction={<button type="button">New project</button>}
        primaryActionPlacement="toolbar"
      />,
    );
    const toolbar = screen.getByTestId('list-page-toolbar');
    const ids = within(toolbar)
      .getAllByTestId(/^slot-/)
      .map((el) => el.getAttribute('data-testid'));
    expect(ids).toEqual(['slot-search', 'slot-filters', 'slot-secondary', 'slot-view', 'slot-export']);
    expect(within(toolbar).getByTestId('page-primary-action-slot')).toBeInTheDocument();
  });

  it('pushes the view-switcher to the right edge of the toolbar', () => {
    render(
      <ListPage title="Projects" view={<div data-testid="slot-view">view</div>}>
        body
      </ListPage>,
    );
    // the view slot carries the right-alignment hook so it never sits inline with filters
    const viewWrap = screen.getByTestId('list-page-view');
    expect(viewWrap.className).toContain('ml-auto');
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
});
