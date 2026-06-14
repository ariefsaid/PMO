/**
 * Enforcement guard: "deal" noun elimination (Part 3 of r2fix-enforce wave).
 *
 * CW-1 decision (DESIGN.md §7): "Project" is the canonical noun everywhere.
 * "Deal" and "opportunity" are removed from user-visible strings.
 *
 * These tests verify that user-visible text in the affected record pages
 * does NOT contain the word "deal" (case-insensitive). Code identifiers
 * (variable names, function names, comments) are NOT in scope — only
 * what the user reads in the UI (toast text, aria-labels, button labels,
 * card headings, body copy).
 *
 * Legitimate exceptions (kept per CW-1):
 *   - "Sales Pipeline" as a list/view name — fine.
 *   - Lifecycle action labels like "Advance to Tender", "Mark won", "Mark lost" — fine.
 *   - "Back to Sales Pipeline" wayfinding link — fine (it names the view, not the record).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ImpersonationProvider } from '../../../auth/impersonation';
import { ToastProvider } from '../../../components/ui';

// ── PipelineLens ──────────────────────────────────────────────────────────────

const { pipelineTrans } = vi.hoisted(() => ({
  pipelineTrans: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/src/lib/db/projectTransitions', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, transitionProject: pipelineTrans };
});
vi.mock('@/src/hooks/useDashboard', () => ({
  useSalesPipeline: () => ({
    data: {
      stages: [],
      projects: [{ id: 'd1', name: 'Acme Deal', status: 'Tender Submitted', contract_value: 500000, win_probability: 0.5 }],
    },
  }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Project Manager' }),
}));
vi.mock('@tanstack/react-query', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useQueryClient: () => ({ invalidateQueries: vi.fn() }) };
});

const project = {
  id: 'd1',
  name: 'Acme Deal',
  code: 'OPP-001',
  status: 'Tender Submitted',
  client_id: 'c1',
  project_manager_id: 'u1',
  contract_value: 500000,
  budget: 0,
  spent: 0,
  start_date: null,
  end_date: null,
  contract_date: null,
  decided_at: null,
  customer_contract_ref: null,
  client: { name: 'Acme' },
  pm: { full_name: 'PM User' },
} as never;

import PipelineLens from '../../../../pages/project-detail/PipelineLens';

describe('Part 3: PipelineLens — no user-visible "deal" or "Opportunity journey" noun (CW-1)', () => {
  it('does not render "deal" (case-insensitive) in user-visible text', () => {
    render(
      <ImpersonationProvider realRole="Project Manager">
        <ToastProvider>
          <PipelineLens project={project} />
        </ToastProvider>
      </ImpersonationProvider>,
    );
    // Check no user-visible text says "deal" (the canonical noun is "Project").
    // textContent picks up all rendered text in the component.
    const body = document.body.textContent ?? '';
    // Strip legitimate exceptions from the check: "Sales Pipeline" link text is OK.
    // We just need to verify no stray "deal" appears.
    // The aria-label on the stepper is also user-visible.
    const dealMatches = (body.match(/\bdeal\b/gi) ?? []).filter(
      // "Sales Pipeline" doesn't contain "deal", so no need to filter.
      () => true,
    );
    expect(dealMatches, `Found user-visible "deal" occurrences: ${JSON.stringify(dealMatches)}`).toHaveLength(0);
  });

  it('renders "Project journey" (not "Opportunity journey") as the journey card heading', () => {
    render(
      <ImpersonationProvider realRole="Project Manager">
        <ToastProvider>
          <PipelineLens project={project} />
        </ToastProvider>
      </ImpersonationProvider>,
    );
    // CardHead must read "Project journey", not "Opportunity journey".
    expect(screen.getByText('Project journey')).toBeInTheDocument();
    expect(screen.queryByText('Opportunity journey')).not.toBeInTheDocument();
  });

  it('does not render "deal" in the won-capture panel either (Mark won → panel open)', async () => {
    // Guard hole fix (code-review #1): the default-state scan missed the won-capture panel,
    // which is unmounted until "Mark won" is clicked. Open it, then re-scan.
    const user = userEvent.setup();
    const winnable = { ...(project as Record<string, unknown>), name: 'Acme Project', status: 'Negotiation' } as never;
    render(
      <ImpersonationProvider realRole="Project Manager">
        <ToastProvider>
          <PipelineLens project={winnable} />
        </ToastProvider>
      </ImpersonationProvider>,
    );
    await user.click(screen.getByRole('button', { name: /mark won/i }));
    // The inline SoD won-capture panel is now open ("Record the won project").
    expect(screen.getByText(/Record the won project/i)).toBeInTheDocument();
    const body = document.body.textContent ?? '';
    const dealMatches = body.match(/\bdeal\b/gi) ?? [];
    expect(dealMatches, `Found user-visible "deal" in won panel: ${JSON.stringify(dealMatches)}`).toHaveLength(0);
  });

  it('the journey stepper has aria-label "Project stage journey" (not "Deal stage journey")', () => {
    render(
      <ImpersonationProvider realRole="Project Manager">
        <ToastProvider>
          <PipelineLens project={project} />
        </ToastProvider>
      </ImpersonationProvider>,
    );
    // Aria-label change: "Deal stage journey" → "Project stage journey".
    expect(screen.getByRole('list', { name: /Project stage journey/i })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: /Deal stage journey/i })).not.toBeInTheDocument();
  });

  it('the read-only gate copy does not mention "deal"', () => {
    render(
      <ImpersonationProvider realRole="Engineer">
        <ToastProvider>
          <PipelineLens project={project} />
        </ToastProvider>
      </ImpersonationProvider>,
    );
    // The read-only notice must not say "deal" — it says "project" instead.
    const body = document.body.textContent ?? '';
    const dealMatches = (body.match(/\bdeal\b/gi) ?? []);
    expect(dealMatches).toHaveLength(0);
  });
});
