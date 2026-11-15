import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { CommentsSection } from './CommentsSection';

// #2115: the mention picker's profile list loads on the first "@", and typing re-renders the composer only.
const h = vi.hoisted(() => ({ list: vi.fn(), profileOpts: vi.fn(), avatarRenders: vi.fn() }));
vi.mock('@/src/lib/db/comments', () => ({ listComments: (...a: unknown[]) => h.list(...a), createComment: vi.fn(), archiveComment: vi.fn() }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'me', org_id: 'o1' } }) }));
vi.mock('@/src/hooks/useTasks', () => ({
  useAssignableProfiles: (opts?: unknown) => { h.profileOpts(opts); return { data: [{ id: 'p2', full_name: 'Peer Person', status: 'active' }] }; },
}));
vi.mock('@/src/components/ui/Avatar', () => ({ Avatar: () => { h.avatarRenders(); return <span />; } }));

const comments = Array.from({ length: 50 }, (_, i) => ({ id: `c${i}`, author_id: 'p2', body: `Note ${i}`, created_at: new Date().toISOString(), author: { id: 'p2', full_name: 'Peer Person' } }));

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><CommentsSection entityType="project" entityId="proj1" /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => { h.list.mockReset().mockResolvedValue(comments); h.profileOpts.mockClear(); h.avatarRenders.mockClear(); });

describe('#2115 CommentsSection requests and renders', () => {
  it('no profile list is requested until the first @ is typed', async () => {
    renderIt();
    const box = await screen.findByLabelText('Add a comment');
    expect(h.profileOpts.mock.calls.every(([opts]) => (opts as { enabled: boolean }).enabled === false)).toBe(true);
    await userEvent.type(box, 'hello ');
    expect(h.profileOpts).not.toHaveBeenCalledWith({ enabled: true });
    await userEvent.type(box, '@Pe');
    expect(h.profileOpts).toHaveBeenLastCalledWith({ enabled: true });
    expect(await screen.findByRole('option', { name: 'Peer Person' })).toBeInTheDocument();
  });

  it('typing in a 50-comment thread does not re-render the comment items', async () => {
    renderIt();
    const box = await screen.findByLabelText('Add a comment');
    await screen.findAllByTestId('comment-item');
    const before = h.avatarRenders.mock.calls.length;
    await userEvent.type(box, 'a long reply');
    expect(h.avatarRenders.mock.calls.length).toBe(before);
  });
});
