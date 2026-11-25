import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('./CommentsSection', () => ({ CommentsSection: ({ entityId }: { entityId: string }) => <div data-testid="comments">{entityId}</div> }));
vi.mock('@/src/hooks/useTaskProofs', () => ({
  useTaskProofs: () => ({ data: [], isPending: false, isError: false }),
  useTaskProofMutations: () => ({ add: { mutate: vi.fn(), isPending: false }, remove: { mutate: vi.fn(), isPending: false } }),
}));

import { TaskCommentsDrawer } from './TaskCommentsDrawer';

describe('AC-WOC-004 a check owner closes it with a note and proof from My tasks', () => {
  it('holds the proof controls beside the notes when opened for the task owner', () => {
    render(<TaskCommentsDrawer task={{ id: 't1', name: 'Drawings checked', status: 'To Do' }} onClose={() => undefined} />);
    expect(screen.getByTestId('comments').textContent).toBe('t1');
    expect(screen.getByTestId('proof-document-input')).toBeInTheDocument();
  });
  it('stays a read view of the notes when opened without the owner\'s task state', () => {
    render(<TaskCommentsDrawer task={{ id: 't1', name: 'Drawings checked' }} onClose={() => undefined} />);
    expect(screen.getByTestId('comments').textContent).toBe('t1');
    expect(screen.queryByTestId('proof-document-input')).toBeNull();
  });
});
