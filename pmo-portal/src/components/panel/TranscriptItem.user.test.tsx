/**
 * The user's own message — echo stays literal, never markdown-parsed (ADR-0054 §3, D-A2-8).
 * FR-AXP-006.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TranscriptItem } from './TranscriptItem';

const userEntry = (text: string) => ({
  key: 'u1',
  event: { id: 'u1', runId: 'r', type: 'user' as const, text, createdAt: '2026-01-01T00:00:00Z' },
});

describe('TranscriptItem — user message', () => {
  it('AC-AXP-005 user message stays literal', () => {
    render(<TranscriptItem entry={userEntry('use * and ** literally')} />);

    expect(screen.getByText('use * and ** literally')).toBeInTheDocument();
    expect(document.querySelector('strong')).toBeNull();
    expect(document.querySelector('em')).toBeNull();
    expect(document.querySelector('li')).toBeNull();
  });

  it('wraps a long unbroken string instead of overflowing the panel', () => {
    render(<TranscriptItem entry={userEntry('x'.repeat(300))} />);
    expect(screen.getByText('x'.repeat(300)).className).toContain('break-words');
  });
});
