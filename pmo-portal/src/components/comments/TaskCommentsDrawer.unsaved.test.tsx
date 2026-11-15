import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';

vi.mock('@/src/lib/db/comments', () => ({
  listComments: vi.fn().mockResolvedValue([]),
  createComment: vi.fn(),
  archiveComment: vi.fn(),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'me', org_id: 'o1' } }) }));
vi.mock('@/src/hooks/useTasks', () => ({ useAssignableProfiles: () => ({ data: [] }) }));

import { TaskCommentsDrawer } from './TaskCommentsDrawer';

function renderDrawer() {
  const onClose = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TaskCommentsDrawer task={{ id: 't1', name: 'Pour slab' }} onClose={onClose} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onClose };
}

describe('#2080 TaskCommentsDrawer unsaved comment', () => {
  beforeEach(() => vi.clearAllMocks());

  it('closing with no draft needs no prompt', async () => {
    const { onClose } = renderDrawer();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closing with a draft comment asks first; Keep editing retains the draft', async () => {
    const { onClose } = renderDrawer();
    await userEvent.type(await screen.findByRole('textbox'), 'Need rebar check');
    await userEvent.keyboard('{Escape}');
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /keep editing/i }));
    expect(screen.getByRole('textbox')).toHaveValue('Need rebar check');
  });
});
