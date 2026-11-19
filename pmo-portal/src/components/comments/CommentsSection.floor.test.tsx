import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { CommentsSection } from './CommentsSection';

// Same harness as CommentsSection.test.tsx — the real composer and list; the comment
// store is faked at the db seam.
const list = vi.fn();
const create = vi.fn();
const archive = vi.fn();
vi.mock('@/src/lib/db/comments', () => ({
  listComments: (...a: unknown[]) => list(...a),
  createComment: (...a: unknown[]) => create(...a),
  archiveComment: (...a: unknown[]) => archive(...a),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'me', org_id: 'o1' } }) }));
vi.mock('@/src/hooks/useTasks', () => ({
  useAssignableProfiles: () => ({
    data: [
      { id: 'me', full_name: 'Me Myself', status: 'active' },
      { id: 'p2', full_name: 'Peer Person', status: 'active' },
    ],
  }),
}));

const mine = { id: 'c1', author_id: 'me', body: 'My note', created_at: new Date().toISOString(), author: { id: 'me', full_name: 'Me Myself' } };
const theirs = { id: 'c2', author_id: 'p2', body: 'Their note', created_at: new Date().toISOString(), author: { id: 'p2', full_name: 'Peer Person' } };

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/projects/proj1']}>
        <CommentsSection entityType="project" entityId="proj1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  list.mockReset().mockResolvedValue([mine, theirs]);
  create.mockReset().mockResolvedValue(undefined);
  archive.mockReset().mockResolvedValue(undefined);
});

describe('CommentsSection floor', () => {
  it('floor: posting a comment with a mention sends the mention id and shows the new comment', async () => {
    const user = userEvent.setup();
    const posted = { id: 'c3', author_id: 'me', body: 'hi @Peer Person ', created_at: new Date().toISOString(), author: { id: 'me', full_name: 'Me Myself' } };
    list.mockResolvedValueOnce([mine, theirs]).mockResolvedValue([mine, theirs, posted]);
    create.mockResolvedValue(undefined);
    renderIt();
    await screen.findAllByTestId('comment-item');

    await user.type(screen.getByRole('textbox'), 'hi @Pee');
    await user.click(await screen.findByRole('button', { name: 'Peer Person' }));
    await user.click(screen.getByRole('button', { name: 'Post comment' }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({ entityType: 'project', entityId: 'proj1', body: 'hi @Peer Person ', mentions: ['p2'] }),
    );
    await waitFor(() => expect(screen.getAllByTestId('comment-item')).toHaveLength(3));
    expect(screen.getByText('hi @Peer Person')).toBeInTheDocument();
  });

  it('floor: deleting own comment confirms first, then the list drops it', async () => {
    const user = userEvent.setup();
    list.mockResolvedValueOnce([mine, theirs]).mockResolvedValue([theirs]);
    renderIt();
    await screen.findAllByTestId('comment-item');

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(archive).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(archive).toHaveBeenCalledWith('c1'));
    await waitFor(() => expect(screen.queryByText('My note')).not.toBeInTheDocument());
  });
});
