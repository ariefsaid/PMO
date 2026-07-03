/**
 * ArtifactSlot tests — Tasks 12/13/14 (RED→GREEN).
 * AC-CV-008: valid spec renders HydratedPrimitive + enabled Save button
 * AC-CV-009: invalid spec renders error notice, no Save
 * AC-CV-010: flag guard — aiComposer off → ArtifactSlot silently skipped (via TranscriptItem)
 * AC-CV-011: Save calls create.mutateAsync with spec + scope:private → shows saved state
 * AC-CV-012: Save button disabled while in-flight
 * AC-CV-013: never auto-saves
 * AC-CV-014: zero axe violations
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { axeViolations } from '../__tests__/axe';
import type { CompositionSpec } from '@/src/lib/viewspec/types';

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockMutateAsync,
  mockExecuteCompiledQuery,
  mockCurrentUser,
  mockAgentAssistant,
  mockAiComposer,
} = vi.hoisted(() => ({
  mockMutateAsync: vi.fn(),
  mockExecuteCompiledQuery: vi.fn(),
  mockCurrentUser: { id: 'user-1', org_id: 'org-1' },
  mockAgentAssistant: { value: true },
  mockAiComposer: { value: true },
}));

vi.mock('@/src/hooks/useUserViews', () => ({
  useUserViewMutations: () => ({
    create: { mutateAsync: mockMutateAsync, isPending: false },
  }),
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: mockCurrentUser }),
}));

vi.mock('@/src/lib/viewspec/executor', () => ({
  executeCompiledQuery: mockExecuteCompiledQuery,
}));

vi.mock('@/src/lib/features', () => ({
  isFeatureEnabled: (key: string) => {
    if (key === 'agentAssistant') return mockAgentAssistant.value;
    if (key === 'aiComposer') return mockAiComposer.value;
    return false;
  },
  FEATURES: {
    agentAssistant: true,
    aiComposer: true,
    userViews: false,
    incidents: false,
  },
}));

// Import component AFTER mocks are set up
import { ArtifactSlot } from './ArtifactSlot';
import { TranscriptItem } from './TranscriptItem';
import type { AgentEvent } from '@/src/lib/agent/runtime/port';

// ── Spec fixtures ──────────────────────────────────────────────────────────────

const VALID_SPEC: CompositionSpec = {
  version: 1,
  panels: [
    {
      id: 'p1',
      primitive: 'KPITile',
      querySpec: {
        entity: 'projects',
        select: ['id'],
        aggregate: { fn: 'count', column: 'id', alias: 'count' },
      },
    },
  ],
};

const INVALID_SPEC: CompositionSpec = {
  version: 1,
  panels: [
    {
      id: 'p-bad',
      primitive: 'KPITile',
      querySpec: {
        entity: 'secret_salaries' as 'projects',
        select: ['id'],
      },
    },
  ],
};

const VALID_PAYLOAD = {
  kind: 'compose_view' as const,
  spec: VALID_SPEC,
  title: 'Active projects by status',
  repairAttempts: 0,
  tokensUsed: 100,
};

const INVALID_PAYLOAD = {
  kind: 'compose_view' as const,
  spec: INVALID_SPEC,
  title: 'Secret salaries',
  repairAttempts: 0,
  tokensUsed: 50,
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function renderSlot(payload = VALID_PAYLOAD) {
  return render(
    <MemoryRouter>
      <ArtifactSlot payload={payload} runId="test-run" />
    </MemoryRouter>,
  );
}

function makeArtifactEvent(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    id: crypto.randomUUID(),
    runId: 'test-run',
    type: 'artifact',
    payload: VALID_PAYLOAD,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('ArtifactSlot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentAssistant.value = true;
    mockAiComposer.value = true;
    // Default: resolve with count data
    mockExecuteCompiledQuery.mockResolvedValue([{ count: 7 }]);
    mockMutateAsync.mockResolvedValue({ id: 'new-view-1', name: 'Test' });
  });

  it('AC-CV-008 renders the slot with HydratedPrimitive output and an enabled Save button for a valid spec', async () => {
    const { container } = renderSlot();

    // The slot region is present with the title in aria-label
    await waitFor(() => {
      expect(container.querySelector('[aria-label*="Active projects by status"]')).toBeInTheDocument();
    });

    // A KPITile is rendered (the count value 7 appears)
    await waitFor(() => {
      expect(screen.getByText('7')).toBeInTheDocument();
    });

    // Save button is present and enabled
    const saveBtn = screen.getByRole('button', { name: /save/i });
    expect(saveBtn).toBeInTheDocument();
    expect(saveBtn).not.toBeDisabled();
  });

  it('AC-CV-009 renders an inline error notice and NO Save button for an invalid spec', async () => {
    renderSlot(INVALID_PAYLOAD);

    await waitFor(() => {
      expect(screen.getByText(/couldn't be validated/i)).toBeInTheDocument();
    });

    // No Save button
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
  });

  it('AC-CV-011 Save calls create.mutateAsync with { spec, scope:private } and shows a saved state', async () => {
    const user = userEvent.setup();
    mockMutateAsync.mockResolvedValueOnce({ id: 'saved-view-id', name: 'Active projects by status' });

    renderSlot();

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('7')).toBeInTheDocument();
    });

    const saveBtn = screen.getByRole('button', { name: /save/i });
    await act(async () => {
      await user.click(saveBtn);
    });

    expect(mockMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        spec: VALID_SPEC,
        scope: 'private',
      }),
    );

    // Saved state visible — look for any element with "saved" text
    await waitFor(() => {
      const savedEls = screen.queryAllByText(/saved/i);
      expect(savedEls.length).toBeGreaterThan(0);
    });
  });

  it('AC-CV-012 disables the Save button while a save is in flight', async () => {
    const user = userEvent.setup();
    // Never resolves — simulates in-flight save
    mockMutateAsync.mockReturnValueOnce(new Promise(() => {}));

    renderSlot();

    await waitFor(() => {
      expect(screen.getByText('7')).toBeInTheDocument();
    });

    const saveBtn = screen.getByRole('button', { name: /save/i });
    await user.click(saveBtn);

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /save/i });
      expect(btn).toBeDisabled();
    });
  });

  it('AC-CV-013 never auto-saves (mutateAsync not called before user interaction)', async () => {
    renderSlot();

    // Wait for component to fully render
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
    });

    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('AC-CV-014 ArtifactSlot has zero axe violations', async () => {
    const { container } = renderSlot();

    // Wait for panel data to load
    await waitFor(() => {
      expect(screen.getByText('7')).toBeInTheDocument();
    });

    const { blocking } = await axeViolations(container);
    if (blocking.length > 0) {
      console.error('Axe violations (ArtifactSlot):', blocking);
    }
    expect(blocking).toEqual([]);
  });

  // ── TranscriptItem routing ────────────────────────────────────────────────────

  it('AC-CV-010 silently skips the artifact event when aiComposer is off', () => {
    mockAiComposer.value = false;

    const event = makeArtifactEvent();
    const entry = { key: 'e1', event };

    render(
      <MemoryRouter>
        <TranscriptItem entry={entry} />
      </MemoryRouter>,
    );

    // No ArtifactSlot rendered — the section/region should not be there
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    // No save button
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
  });

  it('AC-CV-008 (panel) TranscriptItem renders ArtifactSlot for an artifact event when both flags are on', async () => {
    const event = makeArtifactEvent();
    const entry = { key: 'e1', event };

    render(
      <MemoryRouter>
        <TranscriptItem entry={entry} />
      </MemoryRouter>,
    );

    // ArtifactSlot section should be present
    await waitFor(() => {
      const region = document.querySelector('section[aria-label*="Composed view"]');
      expect(region).toBeInTheDocument();
    });
  });

  // ── Blocker-1: success-text token rule (graduated from Discover pass 2026-06-30) ──
  // DESIGN.md §5 ApprovalChip Token rule (Blocker-6): success-green text MUST use
  // text-[hsl(var(--success-text))] — the AA-darkened --success-text token.
  // Using raw text-green-600 bypasses the token pipeline (different L, fails AA, breaks dark-mode).

  it('Blocker-1 Saved label does NOT use raw text-green-600 class (must use success-text token)', async () => {
    const user = userEvent.setup();
    mockMutateAsync.mockResolvedValueOnce({ id: 'saved-view-id', name: 'Test' });

    const { container } = renderSlot();

    await waitFor(() => {
      expect(screen.getByText('7')).toBeInTheDocument();
    });

    const saveBtn = screen.getByRole('button', { name: /save/i });
    await act(async () => {
      await user.click(saveBtn);
    });

    // Wait for saved state
    await waitFor(() => {
      expect(screen.queryAllByText(/saved/i).length).toBeGreaterThan(0);
    });

    // No element should use the off-palette raw green literal
    const allEls = Array.from(container.querySelectorAll('*'));
    allEls.forEach((el) => {
      const cls = (el as HTMLElement).className ?? '';
      if (typeof cls === 'string' && /saved/i.test(el.textContent ?? '')) {
        expect(cls).not.toContain('text-green-600');
      }
    });
    // More directly: assert the success-text token IS used on the saved span
    const savedSpan = Array.from(container.querySelectorAll('span')).find(
      (s) => /^saved$/i.test(s.textContent?.trim() ?? ''),
    );
    if (savedSpan) {
      expect(savedSpan.className).not.toContain('text-green-600');
      expect(savedSpan.className).toContain('success-text');
    }
  });

  // ── Blocker-2: control height 32px / h-8 rule (graduated from Discover pass 2026-06-30) ──
  // DESIGN.md §5 Buttons: ALL interactive controls 32px (h-8). Using py-1.5/py-1 alone gives ~28-30px.

  it('Blocker-2 Save button has h-8 class (32px DESIGN.md control height rule)', async () => {
    renderSlot();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
    });

    const saveBtn = screen.getByRole('button', { name: /save/i });
    expect(saveBtn.className).toContain('h-8');
  });

  it('Blocker-2 Open-view link chip has h-8 class (32px DESIGN.md control height rule)', async () => {
    const user = userEvent.setup();
    mockMutateAsync.mockResolvedValueOnce({ id: 'saved-view-id', name: 'Test' });

    const { container } = renderSlot();

    await waitFor(() => {
      expect(screen.getByText('7')).toBeInTheDocument();
    });

    const saveBtn = screen.getByRole('button', { name: /save/i });
    await act(async () => {
      await user.click(saveBtn);
    });

    await waitFor(() => {
      const link = container.querySelector('a[href*="/views/"]');
      expect(link).toBeInTheDocument();
    });

    const link = container.querySelector('a[href*="/views/"]') as HTMLElement;
    expect(link.className).toContain('h-8');
  });

  // ── Blocker-3: per-panel onRetry parity with I3 UserViewRenderer (graduated 2026-06-30) ──
  // FR-VR-038 + jtbd §82: every panel in an artifact slot must carry a Retry affordance on error.
  // A transient executeCompiledQuery failure must not leave the user with a dead doorway.

  it('Blocker-3 per-panel error state shows a Retry button that re-fires the query', async () => {
    const user = userEvent.setup();

    // Reject once, then resolve
    mockExecuteCompiledQuery
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValueOnce([{ count: 42 }]);

    renderSlot();

    // Error state: Retry button should appear
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    });

    // Click Retry
    await act(async () => {
      await user.click(screen.getByRole('button', { name: /retry/i }));
    });

    // After retry resolves, data should render
    await waitFor(() => {
      expect(screen.getByText('42')).toBeInTheDocument();
    });
  });

  // ── Blocker-4: editable name input before Save (graduated from Discover pass 2026-06-30) ──
  // CV-OD-002 / FR-CV-018: "user can rename on Save" must be a REAL affordance,
  // not just rationale. The slot must expose an editable name field pre-filled with payload.title.

  it('Blocker-4 ArtifactSlot renders an editable name input pre-filled with payload.title', async () => {
    renderSlot();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
    });

    // Name input must be present and pre-filled with the title
    const nameInput = screen.getByRole('textbox', { name: /view name/i });
    expect(nameInput).toBeInTheDocument();
    expect((nameInput as HTMLInputElement).value).toBe(VALID_PAYLOAD.title);
  });

  it('Blocker-4 Save calls create.mutateAsync with the EDITED name, not the original payload.title', async () => {
    const user = userEvent.setup();
    mockMutateAsync.mockResolvedValueOnce({ id: 'saved-view-id', name: 'My custom name' });

    renderSlot();

    await waitFor(() => {
      expect(screen.getByText('7')).toBeInTheDocument();
    });

    // Edit the name
    const nameInput = screen.getByRole('textbox', { name: /view name/i });
    await user.clear(nameInput);
    await user.type(nameInput, 'My custom name');

    const saveBtn = screen.getByRole('button', { name: /save/i });
    await act(async () => {
      await user.click(saveBtn);
    });

    expect(mockMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'My custom name',
        spec: VALID_SPEC,
        scope: 'private',
      }),
    );
  });
});
