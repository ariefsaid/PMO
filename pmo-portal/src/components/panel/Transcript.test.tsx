/**
 * Transcript component tests.
 * NFR-AP-PERF-003: transcript cap at 200 visible entries + "Show earlier" affordance.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import type { TranscriptEntry } from '@/src/hooks/useAssistantPanel';
import { Transcript, TRANSCRIPT_CAP } from './Transcript';

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

describe('Transcript — NFR-AP-PERF-003 entry cap', () => {
  it('TRANSCRIPT_CAP is exported and equals 200', () => {
    expect(TRANSCRIPT_CAP).toBe(200);
  });

  it('renders all entries when count ≤ 200 (no cap, no Show earlier)', () => {
    const entries = makeEntries(200);
    render(<Transcript transcript={entries} />);

    // All 200 entries should be visible
    expect(screen.getByText('Entry 0')).toBeInTheDocument();
    expect(screen.getByText('Entry 199')).toBeInTheDocument();

    // No "Show earlier" button
    expect(screen.queryByRole('button', { name: /show earlier/i })).not.toBeInTheDocument();
  });

  it('NFR-AP-PERF-003 caps at 200 when transcript has 201+ entries — shows "Show earlier"', () => {
    const entries = makeEntries(201);
    render(<Transcript transcript={entries} />);

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
    render(<Transcript transcript={entries} />);

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
    render(<Transcript transcript={[]} emptySlot={<div>Empty here</div>} />);
    expect(screen.getByText('Empty here')).toBeInTheDocument();
  });
});
