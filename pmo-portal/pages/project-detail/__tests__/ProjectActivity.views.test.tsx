import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

vi.mock('@/src/hooks/useComments', () => ({
  useComments: () => ({ data: [{ id: 'c1' }], isPending: false, isError: false }),
}));
vi.mock('@/src/components/comments/CommentsSection', () => ({
  CommentsSection: () => <div>Project comments</div>,
}));
vi.mock('@/src/components/history/RecordHistory', () => ({
  RecordHistory: ({ kindFilters }: { kindFilters?: boolean }) => (
    <div data-testid="record-history" data-kind-filters={String(kindFilters)}>Change history</div>
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

    await user.click(screen.getByRole('tab', { name: /Comments/ }));
    expect(screen.getByText('Project comments')).toBeInTheDocument();
    expect(screen.queryByText('Change history')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Changes' }));
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
