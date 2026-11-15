/**
 * Chat component tests.
 * NFR-AP-PERF-003: transcript cap at 200 visible entries + "Show earlier" affordance.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import type { TranscriptEntry } from '@/src/hooks/useAssistantPanel';
import { Chat } from './Chat';

function makeEntries(count: number): TranscriptEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    key: `entry-${i}`,
    event: {
      id: `id-${i}`,
      runId: 'test-run',
      type: 'system' as const,
      text: `Entry ${i}`,
      createdAt: new Date().toISOString(),
    },
  }));
}

describe('Chat — NFR-AP-PERF-003 entry cap', () => {
  // The cap is a private constant; its value is pinned through the visible boundary:
  // 200 entries render uncapped, 201+ hide the oldest behind "Show earlier".

  it('renders all entries when count ≤ 200 (no cap, no Show earlier)', () => {
    const entries = makeEntries(200);
    render(<Chat transcript={entries} />);

    // All 200 entries should be visible
    expect(screen.getByText('Entry 0')).toBeInTheDocument();
    expect(screen.getByText('Entry 199')).toBeInTheDocument();

    // No "Show earlier" button
    expect(screen.queryByRole('button', { name: /show earlier/i })).not.toBeInTheDocument();
  });

  it('NFR-AP-PERF-003 caps at 200 when transcript has 201+ entries — shows "Show earlier"', () => {
    const entries = makeEntries(201);
    render(<Chat transcript={entries} />);

    // The OLDEST entry (Entry 0) should be hidden (capped)
    expect(screen.queryByText('Entry 0')).not.toBeInTheDocument();
    // The most recent 200 entries should be visible
    expect(screen.getByText('Entry 1')).toBeInTheDocument();
    expect(screen.getByText('Entry 200')).toBeInTheDocument();

    // "Show earlier" button must be present
    expect(screen.getByRole('button', { name: /show earlier/i })).toBeInTheDocument();
  });

  it('NFR-AP-PERF-003 "Show earlier" button reveals all entries when clicked', async () => {
    const user = userEvent.setup();
    const entries = makeEntries(205);
    render(<Chat transcript={entries} />);

    // Initially Entry 0..4 are hidden
    expect(screen.queryByText('Entry 0')).not.toBeInTheDocument();

    const showBtn = screen.getByRole('button', { name: /show earlier/i });
    await user.click(showBtn);

    // All entries including Entry 0 should now be visible
    expect(screen.getByText('Entry 0')).toBeInTheDocument();
    expect(screen.getByText('Entry 204')).toBeInTheDocument();

    // "Show earlier" button should disappear after expansion
    expect(screen.queryByRole('button', { name: /show earlier/i })).not.toBeInTheDocument();
  });

  it('renders empty slot when transcript is empty', () => {
    render(<Chat transcript={[]} emptySlot={<div>Empty here</div>} />);
    expect(screen.getByText('Empty here')).toBeInTheDocument();
  });
});

describe('Chat — #2126 pin-to-bottom', () => {
  it('auto-scroll pins with behavior instant (streaming must not tween)', () => {
    const calls: ScrollIntoViewOptions[] = [];
    const original = window.HTMLElement.prototype.scrollIntoView;
    window.HTMLElement.prototype.scrollIntoView = function spy(arg?: ScrollIntoViewOptions) {
      calls.push(arg ?? {});
    } as typeof window.HTMLElement.prototype.scrollIntoView;
    try {
      render(<Chat transcript={makeEntries(3)} />);
      // Deliberate #2126 behaviour change: the pin is instant so a new chunk never
      // interrupts the previous chunk's smooth tween (the panel kept moving for the
      // whole response). The scroll-to-bottom itself still happens.
      expect(calls.some((c) => c.behavior === 'instant' && c.block === 'end')).toBe(true);
    } finally {
      window.HTMLElement.prototype.scrollIntoView = original;
    }
  });
});

describe('Chat — AC-AGP-022 thumbs feedback persists', () => {
  function makeAssistantEntry(id: string, text: string): TranscriptEntry {
    return {
      key: id,
      event: {
        id,
        runId: 'test-run',
        type: 'assistant',
        text,
        createdAt: new Date().toISOString(),
      },
    };
  }

  function makeUserEntry(id: string, text: string): TranscriptEntry {
    return {
      key: id,
      event: {
        id,
        runId: 'test-run',
        type: 'user',
        text,
        createdAt: new Date().toISOString(),
      },
    };
  }

  function makeToolEntry(id: string): TranscriptEntry {
    return {
      key: id,
      event: {
        id,
        runId: 'test-run',
        type: 'tool',
        payload: { toolName: 'query_entity' },
        createdAt: new Date().toISOString(),
      },
    };
  }

  it('AC-AGP-022 thumbs feedback persists', async () => {
    const user = userEvent.setup();
    const onRate = vi.fn();
    const entries = [
      makeUserEntry('u1', 'How many active projects?'),
      makeAssistantEntry('a1', 'You have 4 active projects.'),
      makeToolEntry('t1'),
    ];
    render(<Chat transcript={entries} onRate={onRate} />);

    // Thumbs appear only on the assistant row — scope queries to that row.
    const assistantBubble = screen.getByTestId('assistant-bubble');
    const assistantRow = assistantBubble.closest('[data-transcript-item]') ?? assistantBubble.parentElement!;

    const goodBtn = within(assistantRow as HTMLElement).getByRole('button', { name: /good response/i });
    const badBtn = within(assistantRow as HTMLElement).getByRole('button', { name: /bad response/i });
    expect(goodBtn).toBeInTheDocument();
    expect(badBtn).toBeInTheDocument();

    // No thumbs on the user or tool rows — exactly one of each thumb button total.
    expect(screen.getAllByRole('button', { name: /good response/i })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /bad response/i })).toHaveLength(1);

    // Click thumbs-down → a downvote-reason picker appears with the four options.
    await user.click(badBtn);
    expect(screen.getByRole('button', { name: /inaccurate/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /not helpful/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /wrong tool/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /too slow/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /inaccurate/i }));
    expect(onRate).toHaveBeenCalledWith('a1', 'down', 'inaccurate');
  });

  it('thumbs-up calls onRate with rating up and no reason', async () => {
    const user = userEvent.setup();
    const onRate = vi.fn();
    const entries = [makeAssistantEntry('a2', 'Here is your answer.')];
    render(<Chat transcript={entries} onRate={onRate} />);

    await user.click(screen.getByRole('button', { name: /good response/i }));
    expect(onRate).toHaveBeenCalledWith('a2', 'up', undefined);
  });

  it('does not render thumbs when onRate is not provided', () => {
    const entries = [makeAssistantEntry('a3', 'Answer without feedback wiring.')];
    render(<Chat transcript={entries} />);
    expect(screen.queryByRole('button', { name: /good response/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /bad response/i })).not.toBeInTheDocument();
  });

  it('thumbs buttons are keyboard-operable with visible focus', async () => {
    const user = userEvent.setup();
    const onRate = vi.fn();
    const entries = [makeAssistantEntry('a4', 'Keyboard reachable answer.')];
    render(<Chat transcript={entries} onRate={onRate} />);

    await user.tab();
    // First focusable in the panel-less Chat is the "good response" thumb
    // (Chat renders no other interactive control for a single assistant entry).
    expect(screen.getByRole('button', { name: /good response/i })).toHaveFocus();
  });
});

describe('Chat — #2047 performance audit', () => {
  const counts: Record<string, number> = {};
  const mk = (i: number, text: string): TranscriptEntry => ({
    key: `p${i}`,
    event: { id: `p${i}`, runId: 'r', type: 'assistant', text, createdAt: '2026-01-01T00:00:00Z' },
  });

  it('AC-2047-PERF-1 re-renders only the streaming item per frame', async () => {
    vi.resetModules();
    vi.doMock('./Markdown', () => ({
      Markdown: ({ text }: { text: string }) => {
        counts[text] = (counts[text] ?? 0) + 1;
        return <p>{text}</p>;
      },
    }));
    const { Chat: ChatUnderCount } = await import('./Chat');
    const early = [mk(0, 'first'), mk(1, 'second'), mk(2, 'third')];
    const { rerender } = render(<ChatUnderCount transcript={[...early, mk(3, 'str')]} phase="running" />);
    rerender(<ChatUnderCount transcript={[...early, mk(3, 'stream')]} phase="running" />);
    expect(counts.first).toBe(1);
    expect(counts.second).toBe(1);
    expect(counts.third).toBe(1);
    expect(counts.stream).toBe(1);
    vi.doUnmock('./Markdown');
  });
});

describe('Chat — tool chips and streaming caret', () => {
  const tool = (i: number, entity: string): TranscriptEntry => ({
    key: `t${i}`,
    event: { id: `t${i}`, runId: 'r', type: 'tool', payload: { entity, rowCount: i }, createdAt: '2026-01-01T00:00:00Z' },
  });
  const answer = (text: string): TranscriptEntry => ({
    key: 'a1',
    event: { id: 'a1', runId: 'r', type: 'assistant', text, createdAt: '2026-01-01T00:00:00Z' },
  });

  it('AC-AP-013 consecutive tool calls read as one run of chips, one chip per call', () => {
    render(<Chat transcript={[tool(1, 'projects'), tool(2, 'invoices'), answer('done')]} />);
    expect(screen.getAllByRole('list')).toHaveLength(1);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText(/Looked up projects/)).toBeInTheDocument();
    expect(screen.getByText(/Looked up invoices/)).toBeInTheDocument();
  });

  it('shows the caret only on the newest answer while the run is live, hidden from assistive tech', () => {
    const { rerender, container } = render(<Chat transcript={[answer('partial')]} phase="running" />);
    const caret = container.querySelector('.stream-caret');
    expect(caret).not.toBeNull();
    expect(caret).toHaveAttribute('aria-hidden', 'true');
    rerender(<Chat transcript={[answer('partial answer')]} phase="idle" />);
    expect(container.querySelector('.stream-caret')).toBeNull();
  });
});
