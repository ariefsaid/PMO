import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

vi.mock('@/src/hooks/useComments', () => ({
  useComments: () => ({ data: [{ id: 'c1' }], isPending: false, isError: false }),
}));
vi.mock('@/src/components/comments/CommentsSection', () => ({
  CommentsSection: () => <div>Project comments</div>,
}));
vi.mock('@/src/components/history/RecordHistory', () => ({
  RecordHistory: ({ kindFilters, kind }: { kindFilters?: boolean; kind?: string }) => (
    <div data-testid="record-history" data-kind-filters={String(kindFilters)} data-kind={kind ?? ''}>Change history</div>
  ),
}));

import { ProjectActivity } from '../ProjectActivity';

describe('ProjectActivity views', () => {
  it('switches between All, Comments, and Changes while keeping record filters on history views', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ProjectActivity projectId="p1" /></MemoryRouter>);

    expect(screen.getByText('Project comments')).toBeInTheDocument();
    expect(screen.getByText('Change history')).toBeInTheDocument();
    expect(screen.getByTestId('record-history')).toHaveAttribute('data-kind-filters', 'true');

    await user.click(screen.getByRole('button', { name: 'Comments' }));
    expect(screen.getByText('Project comments')).toBeInTheDocument();
    expect(screen.queryByText('Change history')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Changes' }));
    expect(screen.queryByText('Project comments')).not.toBeInTheDocument();
    expect(screen.getByTestId('record-history')).toHaveAttribute('data-kind-filters', 'true');
  });
});

// Floor (#13/#14 in floor-tests/project-record.md): the deal Overview embeds the same Activity card
// inline, so its own name and its filter control must survive — the record-history filters are only
// offered on the All view there, because Comments and Changes are already one kind each.
describe('ProjectActivity on a deal Overview (compact)', () => {
  it('keeps the card name the record page relies on and offers the kind filters on All only', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ProjectActivity projectId="p1" compact title="Notes and activity" /></MemoryRouter>);

    expect(screen.getByRole('region', { name: 'Notes and activity' })).toBeInTheDocument();
    expect(screen.getByText('Project comments')).toBeInTheDocument();
    expect(screen.getByTestId('record-history')).toHaveAttribute('data-kind-filters', 'true');

    await user.click(screen.getByRole('tab', { name: 'Changes' }));
    expect(screen.getByTestId('record-history')).toHaveAttribute('data-kind-filters', 'false');
  });
});

// Move 3 (ruled): the drawer body carries ONE filter row — the comment view and the recorded-change
// kinds are chips in the same row, so no second filter set stacks beneath it. The Changes chip stays
// (its name is the journey's) and All still means "the conversation and every recorded change".
describe('ProjectActivity one filter row', () => {
  it('puts Comments, Changes and every record kind in a single row that filters one list', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ProjectActivity projectId="p1" /></MemoryRouter>);

    const row = screen.getByRole('group', { name: 'Activity view' });
    expect(within(row).getAllByRole('button').map((button) => button.getAttribute('data-value'))).toEqual([
      'all', 'comments', 'changes', 'project', 'budget', 'workOrders', 'procurement', 'tasks',
    ]);
    expect(screen.queryByRole('tablist', { name: 'Activity view' })).toBeNull();
    expect(within(row).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    // No second filter set anywhere in the drawer body.
    expect(screen.queryByRole('group', { name: 'Filter by record kind' })).toBeNull();

    await user.click(within(row).getByRole('button', { name: 'Comments' }));
    expect(screen.getByText('Project comments')).toBeInTheDocument();
    expect(screen.queryByText('Change history')).not.toBeInTheDocument();

    const tasksChip = row.querySelector<HTMLElement>('[data-value="tasks"]')!;
    await user.click(tasksChip);
    expect(screen.queryByText('Project comments')).not.toBeInTheDocument();
    expect(screen.getByTestId('record-history')).toHaveAttribute('data-kind', 'tasks');

    await user.click(within(row).getByRole('button', { name: 'Changes' }));
    expect(screen.getByTestId('record-history')).toHaveAttribute('data-kind', 'all');
    expect(screen.queryByText('Project comments')).toBeNull();

    await user.click(within(row).getByRole('button', { name: 'All' }));
    expect(screen.getByText('Project comments')).toBeInTheDocument();
    expect(screen.getByTestId('record-history')).toHaveAttribute('data-kind', 'all');
  });
});

// Move 3 (ruled): the drawer header already names this screen — the card and its head inside it
// said "Activity" a second time.
describe('ProjectActivity inside the drawer', () => {
  it('names the screen once: no second Activity heading or card in the drawer body', () => {
    render(<MemoryRouter><ProjectActivity projectId="p1" /></MemoryRouter>);

    expect(screen.queryByRole('heading', { name: 'Activity' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Activity' })).not.toBeInTheDocument();
    // Nothing disappears with the card: the switcher and both views are still on screen.
    expect(screen.getByRole('group', { name: 'Activity view' })).toBeInTheDocument();
    expect(screen.getByText('Project comments')).toBeInTheDocument();
    expect(screen.getByText('Change history')).toBeInTheDocument();
  });
});
