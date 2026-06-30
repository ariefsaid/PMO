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
      <ArtifactSlot payload={payload} />
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
});
