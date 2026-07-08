/**
 * ActivityTrail component tests — the persistent, legible activity checklist shown
 * while an agent run is in flight.
 *
 * Each step is either "done" (✓ + label + optional detail) or the current/active step
 * (spinner + label + "…"). The region is a polite live log so SR users hear progress.
 * Renders nothing when the trail is empty.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { ActivityTrail } from './ActivityTrail';
import type { TrailStep } from '@/src/hooks/useAssistantPanel';

describe('ActivityTrail', () => {
  it('renders nothing when items is empty', () => {
    const { container } = render(<ActivityTrail items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a done row with a check glyph, the friendly label, and the detail', () => {
    const items: TrailStep[] = [
      { id: 'a', label: 'Looking up projects…', done: true, detail: '4 found' },
    ];
    render(<ActivityTrail items={items} />);

    const log = screen.getByRole('log', { name: /assistant activity/i });
    expect(log).toHaveAttribute('aria-live', 'polite');
    expect(log).toHaveAttribute('aria-atomic', 'false');

    expect(screen.getByText('Checking your projects')).toBeInTheDocument();
    expect(screen.getByText(/4 found/)).toBeInTheDocument();
    // ✓ check glyph is present (aria-hidden)
    expect(log.textContent).toContain('✓');
  });

  it('renders the current (not-done) row with a spinner and a trailing "…" and no check', () => {
    const items: TrailStep[] = [
      { id: 'b', label: 'Looking up crm activities…', done: false },
    ];
    render(<ActivityTrail items={items} />);

    const log = screen.getByRole('log', { name: /assistant activity/i });
    expect(screen.getByText(/Looking for CRM activity/)).toBeInTheDocument();
    // Current row shows a trailing ellipsis (still in progress).
    expect(log.textContent).toContain('…');
    // No completed check for an in-progress row.
    expect(log.textContent).not.toContain('✓');
    // Spinner carries the motion-reduce guard + animate-spin.
    const spinner = log.querySelector('svg[aria-hidden="true"]');
    expect(spinner).not.toBeNull();
    expect(spinner?.getAttribute('class')).toContain('animate-spin');
    expect(spinner?.getAttribute('class')).toContain('motion-reduce:animate-none');
  });

  it('renders a mixed trail with a done row followed by the current row', () => {
    const items: TrailStep[] = [
      { id: 'a', label: 'Looking up projects…', done: true, detail: '4 found' },
      { id: 'b', label: 'Looking up crm activities…', done: false },
    ];
    render(<ActivityTrail items={items} />);

    expect(screen.getByText('Checking your projects')).toBeInTheDocument();
    expect(screen.getByText(/4 found/)).toBeInTheDocument();
    expect(screen.getByText(/Looking for CRM activity/)).toBeInTheDocument();
  });

  it('renders a done row without a detail when detail is absent', () => {
    const items: TrailStep[] = [
      { id: 'c', label: 'Logging an activity…', done: true },
    ];
    render(<ActivityTrail items={items} />);

    expect(screen.getByText('Logging an activity')).toBeInTheDocument();
    expect(screen.queryByText(/found/i)).not.toBeInTheDocument();
  });
});
