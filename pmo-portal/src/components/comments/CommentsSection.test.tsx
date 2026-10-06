import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CommentsSection } from './CommentsSection';

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
      <CommentsSection entityType="project" entityId="proj1" />
    </QueryClientProvider>,
  );
}

describe('CommentsSection', () => {
  beforeEach(() => {
    list.mockReset().mockResolvedValue([mine, theirs]);
    create.mockReset().mockResolvedValue(undefined);
    archive.mockReset().mockResolvedValue(undefined);
  });

  it('AC-CMT-001 shows each comment with its author and body, oldest first', async () => {
    renderIt();
    const items = await screen.findAllByTestId('comment-item');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Me Myself');
    expect(items[0]).toHaveTextContent('My note');
    expect(items[1]).toHaveTextContent('Peer Person');
  });

  it('AC-CMT-001 posts a comment on the record and clears the box', async () => {
    const user = userEvent.setup();
    renderIt();
    await screen.findAllByTestId('comment-item');
    await user.type(screen.getByRole('textbox'), 'Is the scope final?');
    await user.click(screen.getByRole('button', { name: 'Post comment' }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({ entityType: 'project', entityId: 'proj1', body: 'Is the scope final?', mentions: [] }),
    );
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''));
  });

  it('AC-CMT-002 @ picks an org member and sends their id as a mention', async () => {
    const user = userEvent.setup();
    renderIt();
    await screen.findAllByTestId('comment-item');
    await user.type(screen.getByRole('textbox'), 'hi @Pee');
    await user.click(await screen.findByRole('button', { name: 'Peer Person' }));
    await user.click(screen.getByRole('button', { name: 'Post comment' }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ body: 'hi @Peer Person ', mentions: ['p2'] })),
    );
  });

  it('AC-CMT-001 only the author gets a delete control, and it confirms first', async () => {
    const user = userEvent.setup();
    renderIt();
    await screen.findAllByTestId('comment-item');
    const del = screen.getAllByRole('button', { name: 'Delete' });
    expect(del).toHaveLength(1);
    await user.click(del[0]);
    expect(archive).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(archive.mock.calls[0][0]).toBe('c1'));
  });

  it('AC-CMT-001 blocks posting a blank comment', async () => {
    renderIt();
    await screen.findAllByTestId('comment-item');
    expect(screen.getByRole('button', { name: 'Post comment' })).toBeDisabled();
  });
});
