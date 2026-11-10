import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

const activityModuleLoads = vi.hoisted(() => ({ comments: 0, history: 0 }));

vi.mock('@/src/hooks/useComments', () => ({
  useComments: () => ({ data: [{ id: 'c1' }], isPending: false, isError: false }),
}));
vi.mock('@/src/components/comments/CommentsSection', () => {
  activityModuleLoads.comments += 1;
  return { CommentsSection: () => <div>Project comments</div> };
});
vi.mock('@/src/components/history/RecordHistory', () => {
  activityModuleLoads.history += 1;
  return { RecordHistory: ({ kindFilters }: { kindFilters?: boolean }) => (
    <div data-testid="record-history" data-kind-filters={String(kindFilters)}>Change history</div>
  ) };
});

describe('ProjectActivity views', () => {
  it('loads comments and history only when the Activity content mounts', async () => {
    expect(activityModuleLoads).toEqual({ comments: 0, history: 0 });
    const { ProjectActivity } = await import('../ProjectActivity');
    expect(activityModuleLoads).toEqual({ comments: 0, history: 0 });

    const user = userEvent.setup();
    render(<MemoryRouter><ProjectActivity projectId="p1" /></MemoryRouter>);

    expect(await screen.findByText('Project comments')).toBeInTheDocument();
    expect(await screen.findByText('Change history')).toBeInTheDocument();
    expect(activityModuleLoads).toEqual({ comments: 1, history: 1 });
    expect(screen.getByTestId('record-history')).toHaveAttribute('data-kind-filters', 'true');

    await user.click(screen.getByRole('tab', { name: /Comments/ }));
    expect(screen.getByText('Project comments')).toBeInTheDocument();
    expect(screen.queryByText('Change history')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Changes' }));
    expect(screen.queryByText('Project comments')).not.toBeInTheDocument();
    expect(screen.getByTestId('record-history')).toHaveAttribute('data-kind-filters', 'true');
  });
});
