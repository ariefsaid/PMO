/**
 * ArtifactSlot — renders a compose_view artifact event inline in the AssistantPanel transcript.
 * FR-CV-013..020, NFR-CV-A11Y-001/002, NFR-CV-PERF-002, NFR-CV-SEC-007.
 *
 * Design (CV-OD-004): stays in panel; shows "Saved" + link chip on success.
 * Never auto-saves (FR-CV-019). Agent-proposes / user-disposes.
 *
 * Port isolation (NFR-CV-SEC-007): imports only src/lib/viewspec/, src/hooks/useComposeArtifact,
 * src/components/dashboard/HydratedPrimitive, src/components/dashboard/ChartFrame,
 * react-router-dom (for Link), DESIGN.md tokens.
 *
 * Design-system rules enforced (graduated from Discover pass 2026-06-30):
 * - Blocker-1 / DESIGN.md Blocker-6: "Saved" text MUST use text-[hsl(var(--success-text))],
 *   NOT the raw Tailwind literal text-green-600 (different L, fails AA, breaks dark-mode).
 * - Blocker-2 / DESIGN.md Blocker-9: Save button + Open-view link MUST be h-8 (32px), the
 *   app-wide control height rule; py-1.5/py-1 alone gives ~28-30px.
 * - Blocker-3 / FR-VR-038: per-panel error state carries onRetry parity with I3 UserViewRenderer.
 * - Blocker-4 / CV-OD-002 / FR-CV-018: editable name input pre-filled from payload.title so
 *   "user can rename on Save" is a real affordance, not just rationale.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { HydratedPrimitive } from '@/src/components/dashboard/HydratedPrimitive';
import { ChartFrame } from '@/src/components/dashboard/ChartFrame';
import { executeCompiledQuery } from '@/src/lib/viewspec/executor';
import type { CompiledPanel, CompositionSpec } from '@/src/lib/viewspec/types';
import { useComposeArtifact } from '@/src/hooks/useComposeArtifact';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ArtifactSlotPayload {
  kind: 'compose_view';
  spec: CompositionSpec;
  title: string;
  repairAttempts: number;
  tokensUsed: number;
}

interface ArtifactSlotProps {
  payload: ArtifactSlotPayload;
}

// ── Per-panel fetch state ─────────────────────────────────────────────────────

interface PanelDataState {
  loading: boolean;
  data: unknown[] | null;
  error: Error | null;
}

// ── ArtifactSlot component ────────────────────────────────────────────────────

/**
 * Renders a composed view as an artifact card in the transcript.
 * 1. Client re-validates the spec (defense-in-depth, ADR-0039)
 * 2. Fires parallel executeCompiledQuery calls for each CompiledPanel
 * 3. Renders via HydratedPrimitive (I3 machinery)
 * 4. Offers an editable name + Save affordance (agent-proposes / user-disposes)
 */
export const ArtifactSlot: React.FC<ArtifactSlotProps> = ({ payload }) => {
  const { compiledPanels, validationError, saveStatus, saveError, savedViewId, save } =
    useComposeArtifact(payload.spec);

  // Editable view name (Blocker-4 / CV-OD-002): pre-filled from payload.title.
  // "User can rename on Save" must be a real affordance, not just rationale.
  const [viewName, setViewName] = useState(payload.title);

  // Per-panel fetch state (NFR-CV-PERF-002: parallel queries, per-panel skeleton)
  const [panelStates, setPanelStates] = useState<PanelDataState[]>([]);

  useEffect(() => {
    if (!compiledPanels) return;
    let cancelled = false;

    // Initialize per-panel loading state
    setPanelStates(compiledPanels.map(() => ({ loading: true, data: null, error: null })));

    // Fire all queries in parallel (NFR-CV-PERF-002)
    Promise.allSettled(
      compiledPanels.map((panel: CompiledPanel) => executeCompiledQuery(panel.compiledQuery))
    ).then((results) => {
      if (!cancelled) {
        setPanelStates(
          results.map((r) =>
            r.status === 'fulfilled'
              ? { loading: false, data: r.value as unknown[], error: null }
              : { loading: false, data: null, error: r.reason as Error }
          )
        );
      }
    });

    return () => {
      cancelled = true;
    };
  }, [compiledPanels]);

  // Per-panel retry handler (Blocker-3 / FR-VR-038):
  // Re-fires executeCompiledQuery for a single panel index, mirroring I3 UserViewRenderer parity.
  const retryPanel = useCallback(
    (idx: number, panel: CompiledPanel) => {
      setPanelStates((prev) => {
        const next = [...prev];
        next[idx] = { loading: true, data: null, error: null };
        return next;
      });
      executeCompiledQuery(panel.compiledQuery).then(
        (data) => {
          setPanelStates((prev) => {
            const next = [...prev];
            next[idx] = { loading: false, data: data as unknown[], error: null };
            return next;
          });
        },
        (err: Error) => {
          setPanelStates((prev) => {
            const next = [...prev];
            next[idx] = { loading: false, data: null, error: err };
            return next;
          });
        },
      );
    },
    [],
  );

  // ── Validation error state (FR-CV-011) ────────────────────────────────────
  if (validationError !== null) {
    return (
      <section
        aria-label={`Composed view: ${payload.title}`}
        className="my-2 rounded-lg border border-border bg-card p-4"
      >
        <p className="text-sm text-destructive">
          The composed view couldn&apos;t be validated — try rephrasing your request.
        </p>
        {/* Dev-mode detail (mirrors UserViewRenderer OD-2 pattern) */}
        {import.meta.env.VITE_APP_ENV !== 'prod' && (
          <details className="mt-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer">Developer detail</summary>
            <pre className="mt-1 overflow-auto">
              {`code: ${validationError.code}\ndetail: ${validationError.detail ?? '—'}`}
            </pre>
          </details>
        )}
      </section>
    );
  }

  // ── Main artifact card ────────────────────────────────────────────────────
  const isSaving = saveStatus === 'saving';
  const isSaved = saveStatus === 'saved';

  return (
    <section
      aria-label={`Composed view: ${payload.title}`}
      className="my-2 rounded-lg border border-border bg-card p-4"
    >
      {/* Title heading (FR-CV-016) */}
      <h3 className="mb-3 text-[14px] font-semibold text-foreground">{payload.title}</h3>

      {/* Panels (FR-CV-013/014, NFR-CV-PERF-002) */}
      <div className="flex flex-col gap-3">
        {(compiledPanels ?? []).map((panel, idx) => {
          const state = panelStates[idx] ?? { loading: true, data: null, error: null };
          const data = state.data ?? [];
          return (
            <div
              key={panel.id}
              className="rounded-md border border-border bg-background p-3"
            >
              {/* Blocker-3: pass onRetry so transient errors never leave a dead doorway.
                  Mirrors the FR-VR-038 per-panel retry in I3 UserViewRenderer. */}
              <ChartFrame
                state={
                  state.loading
                    ? 'loading'
                    : state.error
                    ? 'error'
                    : data.length === 0
                    ? 'empty'
                    : 'ready'
                }
                emptyTitle={(panel.props?.emptyTitle as string | undefined) ?? 'No data'}
                onRetry={state.error ? () => retryPanel(idx, panel) : undefined}
              >
                <HydratedPrimitive panel={panel} data={data} />
              </ChartFrame>
            </div>
          );
        })}
      </div>

      {/* Save affordance (FR-CV-017..020) */}
      <div className="mt-3 flex flex-col gap-2">
        {!isSaved ? (
          <>
            {/* Blocker-4 / CV-OD-002: editable name input pre-filled with payload.title.
                "User can rename on Save" must be a real UI affordance, not just rationale. */}
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">View name</span>
              <input
                type="text"
                aria-label="View name"
                value={viewName}
                onChange={(e) => setViewName(e.target.value)}
                disabled={isSaving}
                className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                aria-label="Save composed view"
                aria-disabled={isSaving}
                aria-busy={isSaving}
                disabled={isSaving || !viewName.trim()}
                onClick={() => void save(viewName.trim())}
                className="h-8 rounded-md border border-border bg-primary px-3 py-0 text-xs font-medium text-primary-foreground hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSaving ? 'Saving…' : 'Save to My Views'}
              </button>
              {saveStatus === 'error' && saveError && (
                <span className="text-xs text-destructive">{saveError}</span>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {/* Blocker-1 / DESIGN.md Blocker-6: "Saved" text MUST use --success-text token.
                text-green-600 bypasses the token pipeline (different L, fails AA on tinted fills,
                breaks dark-mode). Enforced by Vitest guard test below. */}
            <span className="text-xs font-medium text-[hsl(var(--success-text))]">Saved</span>
            {savedViewId && (
              <Link
                to={`/views/${savedViewId}`}
                /* Blocker-2 / DESIGN.md Blocker-9: Open-view link chip MUST be h-8 (32px).
                   py-1 alone gives ~28-30px and violates the app-wide control height rule. */
                className="h-8 rounded-md border border-border px-2 py-0 text-xs text-foreground hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring inline-flex items-center"
              >
                Open view →
              </Link>
            )}
            {/* aria-live announcement for save success (NFR-CV-A11Y-002) */}
            <span role="status" aria-live="polite" className="sr-only">
              View saved successfully
            </span>
          </div>
        )}
      </div>
    </section>
  );
};
