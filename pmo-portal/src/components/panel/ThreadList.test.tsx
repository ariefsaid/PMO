/**
 * ThreadList component tests.
 * AC-AGP-019: pinned threads surface above unpinned ones, unpinned ordered by recency.
 * NFR-AGP-A11Y-003: semantic list, accessible name per thread, pinned/recency conveyed by
 * text (not color alone).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import type { AgentThreadListItem } from '@/src/lib/db/agentThreads';
import { ThreadList } from './ThreadList';

function makeThread(overrides: Partial<AgentThreadListItem>): AgentThreadListItem {
  return {
    id: 'thread-1',
    org_id: 'org-1',
    owner_id: 'owner-1',
    title: 'New conversation',
    scope: null,
    pinned_at: null,
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
    archived_at: null,
    latestRunId: null,
    ...overrides,
  };
}

describe('ThreadList', () => {
  it('AC-AGP-019 thread list pinned above unpinned', () => {
    // Given: one pinned + two unpinned threads with descending updated_at recency.
    const pinned = makeThread({
      id: 'thread-pinned',
      title: 'Pinned conversation',
      pinned_at: '2026-06-01T00:00:00.000Z',
      updated_at: '2026-06-15T00:00:00.000Z',
    });
    const recent = makeThread({
      id: 'thread-recent',
      title: 'Most recent unpinned',
      updated_at: '2026-07-02T00:00:00.000Z',
    });
    const older = makeThread({
      id: 'thread-older',
      title: 'Older unpinned',
      updated_at: '2026-07-01T00:00:00.000Z',
    });
    // Props arrive already sorted (DAL owns order) — pinned first, then unpinned by recency.
    const threads = [pinned, recent, older];

    render(<ThreadList threads={threads} onOpen={vi.fn()} />);

    // Semantic list with an accessible name.
    const list = screen.getByRole('list', { name: /recent conversations/i });
    expect(list).toBeInTheDocument();

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    // Rendered order matches the given (pinned-first, then recency) order.
    expect(items[0]).toHaveTextContent('Pinned conversation');
    expect(items[1]).toHaveTextContent('Most recent unpinned');
    expect(items[2]).toHaveTextContent('Older unpinned');

    // Pinned state conveyed by text/aria, not color alone.
    expect(screen.getByText(/pinned/i, { selector: '[data-pinned-marker]' })).toBeInTheDocument();
  });

  it('renders an empty state when there are no threads', () => {
    render(<ThreadList threads={[]} onOpen={vi.fn()} />);
    expect(screen.getByRole('list', { name: /recent conversations/i })).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getByText(/no conversations yet/i)).toBeInTheDocument();
  });

  it('each item is a keyboard-operable button that calls onOpen with thread id and latest run id', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const thread = makeThread({ id: 'thread-x', title: 'Talk about project X', latestRunId: 'run-x' });
    render(<ThreadList threads={[thread]} onOpen={onOpen} />);

    const btn = screen.getByRole('button', { name: /talk about project x/i });
    await user.click(btn);
    expect(onOpen).toHaveBeenCalledWith('thread-x', 'run-x');
  });

  it('each item is reachable via Tab and activatable via Enter', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const thread = makeThread({ id: 'thread-y', title: 'Keyboard reachable thread', latestRunId: 'run-y' });
    render(<ThreadList threads={[thread]} onOpen={onOpen} />);

    await user.tab();
    expect(screen.getByRole('button', { name: /keyboard reachable thread/i })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledWith('thread-y', 'run-y');
  });

  it('calls onOpen with a null run id for a thread with no runs yet', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const thread = makeThread({ id: 'thread-z', title: 'No runs yet', latestRunId: null });
    render(<ThreadList threads={[thread]} onOpen={onOpen} />);

    await user.click(screen.getByRole('button', { name: /no runs yet/i }));
    expect(onOpen).toHaveBeenCalledWith('thread-z', null);
  });
});
