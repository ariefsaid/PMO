/**
 * Rail "Assistant" entry tests (Task 16/17).
 * AC-AP-004 support: Rail entry present/absent by the agentAssistant flag.
 * FR-AP-005: the "Assistant" button calls onOpenAssistant + onNavigate on click.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

// ── Mock impersonation (Executive can see all nav items) ──────────────────────
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({
    effectiveRole: 'Executive',
    realRole: 'Executive',
    canImpersonate: false,
    viewAs: vi.fn(),
  }),
}));

// ── Mock useUserViews (not under test; avoid AuthProvider) ────────────────────
vi.mock('@/src/hooks/useUserViews', () => ({
  useUserViews: () => ({ data: [], isPending: false, isError: false }),
}));

// ── Mock the features module so individual tests can toggle the flag ──────────
vi.mock('@/src/lib/features', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/src/lib/features')>();
  return { ...real };
});

import { Rail } from '../Rail';
import * as features from '@/src/lib/features';

const renderRail = (props: Partial<React.ComponentProps<typeof Rail>> = {}) =>
  render(
    <MemoryRouter>
      <Rail onNavigate={vi.fn()} {...props} />
    </MemoryRouter>,
  );

describe('Rail — agentAssistant flag gate for the "Assistant" entry (AC-AP-004)', () => {
  let spy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    spy?.mockRestore();
  });

  // ── Flag OFF (default) ────────────────────────────────────────────────────

  it('flag off → no "Assistant" button rendered', () => {
    // Default flag is false; no spy needed — just render.
    renderRail();
    expect(screen.queryByRole('button', { name: /assistant/i })).toBeNull();
  });

  it('flag off → other nav items are still rendered', () => {
    renderRail();
    expect(screen.getByRole('link', { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /projects/i })).toBeInTheDocument();
  });

  // ── Flag ON ───────────────────────────────────────────────────────────────

  it('AC-AP-004 flag on → "Assistant" button rendered with aria-pressed', () => {
    spy = vi.spyOn(features, 'isFeatureEnabled').mockImplementation((key) =>
      key === 'agentAssistant' ? true : features.FEATURES[key],
    );
    renderRail();
    const btn = screen.getByRole('button', { name: /assistant/i });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute('aria-pressed');
  });

  it('AC-AP-004 flag on → click calls onOpenAssistant', async () => {
    const user = userEvent.setup();
    const onOpenAssistant = vi.fn();
    spy = vi.spyOn(features, 'isFeatureEnabled').mockImplementation((key) =>
      key === 'agentAssistant' ? true : features.FEATURES[key],
    );
    renderRail({ onOpenAssistant });
    const btn = screen.getByRole('button', { name: /assistant/i });
    await user.click(btn);
    expect(onOpenAssistant).toHaveBeenCalledTimes(1);
  });

  it('AC-AP-004 flag on → click also calls onNavigate', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const onOpenAssistant = vi.fn();
    spy = vi.spyOn(features, 'isFeatureEnabled').mockImplementation((key) =>
      key === 'agentAssistant' ? true : features.FEATURES[key],
    );
    renderRail({ onNavigate, onOpenAssistant });
    const btn = screen.getByRole('button', { name: /assistant/i });
    await user.click(btn);
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('AC-AP-004 flag on → other nav items still rendered when Assistant is on', () => {
    spy = vi.spyOn(features, 'isFeatureEnabled').mockImplementation((key) =>
      key === 'agentAssistant' ? true : features.FEATURES[key],
    );
    renderRail();
    expect(screen.getByRole('link', { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /projects/i })).toBeInTheDocument();
  });

  // ── aria-pressed tracks open state (WCAG 4.1.2, Blocker 5/9) ─────────────

  it('AC-AP-004 aria-pressed=false when assistantPanelOpen=false (panel closed)', () => {
    spy = vi.spyOn(features, 'isFeatureEnabled').mockImplementation((key) =>
      key === 'agentAssistant' ? true : features.FEATURES[key],
    );
    renderRail({ assistantPanelOpen: false });
    const btn = screen.getByRole('button', { name: /assistant/i });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
  });

  it('AC-AP-004 aria-pressed=true when assistantPanelOpen=true (panel open)', () => {
    spy = vi.spyOn(features, 'isFeatureEnabled').mockImplementation((key) =>
      key === 'agentAssistant' ? true : features.FEATURES[key],
    );
    renderRail({ assistantPanelOpen: true });
    const btn = screen.getByRole('button', { name: /assistant/i });
    // aria-pressed must reflect the actual open state — not hardcoded false
    expect(btn).toHaveAttribute('aria-pressed', 'true');
  });
});
