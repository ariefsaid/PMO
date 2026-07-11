import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { TaskPushBadge } from './TaskPushBadge';
import type { PendingPushState } from '@/src/lib/adapterSeam/pendingPush';

const here = dirname(fileURLToPath(import.meta.url));
const badgeSource = readFileSync(resolve(here, './TaskPushBadge.tsx'), 'utf8');

const pushing: PendingPushState = { status: 'pushing', error: null };
const pushed: PendingPushState = { status: 'pushed', error: null };
const pushFailedDefault: PendingPushState = { status: 'push-failed', error: null };
const pushFailedUnreachable: PendingPushState = {
  status: 'push-failed',
  error: { headline: 'external system unreachable — try again', detail: 'DNS failed' },
};

describe('TaskPushBadge — confinement: no hardcoded ClickUp vocabulary (review fix #6)', () => {
  it('the badge module source contains no "ClickUp" string (case-insensitive) — vocabulary confined to clickup/**', () => {
    expect(badgeSource).not.toMatch(/clickup/i);
  });

  it('no state renders the word "ClickUp" in its visible text or tooltip', () => {
    for (const state of [pushing, pushed, pushFailedDefault, pushFailedUnreachable]) {
      const { container, unmount } = render(<TaskPushBadge state={state} />);
      const text = container.textContent ?? '';
      const titles = Array.from(container.querySelectorAll('[title]')).map((e) => e.getAttribute('title') ?? '');
      expect(text).not.toMatch(/clickup/i);
      expect(titles.join(' ')).not.toMatch(/clickup/i);
      unmount();
    }
  });

  it('idle renders nothing', () => {
    const { container } = render(<TaskPushBadge state={{ status: 'idle', error: null }} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('TaskPushBadge — AA contrast + register + a11y (review fix #8)', () => {
  it('push-failed text uses the AA destructive token (--status-lost-text), not raw text-destructive', () => {
    render(<TaskPushBadge state={pushFailedDefault} />);
    const badge = screen.getByRole('status');
    // The AA-darkened destructive label token (0 72% 44% light ≥6:1), the StatusPill `lost` idiom.
    expect(badge.getAttribute('style') ?? '').toContain('--status-lost-text');
    expect(badge.className).not.toContain('text-destructive');
  });

  it('pushed text uses the AA success token (--status-won-text), not raw text-success', () => {
    render(<TaskPushBadge state={pushed} />);
    const badge = screen.getByRole('status');
    expect(badge.getAttribute('style') ?? '').toContain('--status-won-text');
    expect(badge.className).not.toContain('text-success');
  });

  it('badge text is on the board 11.5px register (not 11px)', () => {
    render(<TaskPushBadge state={pushing} />);
    const badge = screen.getByRole('status');
    expect(badge.className).toContain('text-[11.5px]');
    expect(badge.className).not.toContain('text-[11px]');
  });

  it('push-failed default aria-label is NOT duplicated ("push failed: Push failed")', () => {
    render(<TaskPushBadge state={pushFailedDefault} />);
    const badge = screen.getByRole('status');
    expect(badge.getAttribute('aria-label')).not.toBe('push failed: Push failed');
    expect(badge.getAttribute('aria-label')).toBe('push failed');
  });

  it('push-failed with a specific headline carries the reason in the aria-label', () => {
    render(<TaskPushBadge state={pushFailedUnreachable} />);
    const badge = screen.getByRole('status');
    expect(badge.getAttribute('aria-label')).toBe('push failed: external system unreachable — try again');
  });
});
