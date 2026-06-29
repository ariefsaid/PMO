/**
 * User-View Renderer (ADR-0036 §4c / §7, I3, FR-VR-030..043).
 *
 * Renders a saved user_views row as a live PMO page. Guards:
 *   loading  → page-level skeleton (FR-VR-031)
 *   null     → not-found / no-access (FR-VR-032, OD-1)
 *   archived → same as null (FR-VR-033)
 *   too many panels → spec-invalid (OD-9)
 *   spec-invalid → ValidationError → error state (FR-VR-034, OD-2)
 *   empty panels → empty-spec (FR-VR-035, OD-3)
 *   ready → per-panel loading/empty/error/ready (FR-VR-036..042)
 *
 * Security:
 *   - compileCompositionSpec validates before any executeCompiledQuery call (NFR-VR-SEC-004)
 *   - executeCompiledQuery uses the viewer's JWT-scoped supabase client (NFR-VR-SEC-001)
 *   - No data rows are stored in spec or persistent store (NFR-VR-SEC-002)
 *
 * Layering (NFR-VR-LAYER-002):
 *   Imports: src/lib/viewspec/, src/lib/viewspec/executor, src/hooks/useUserViews,
 *            src/auth/useAuth, src/components/dashboard/, src/components/ui/,
 *            react-router-dom (for navigate in OD-1 CTA and useParams for route).
 *   Does NOT import from src/lib/db/* directly.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useUserView } from '@/src/hooks/useUserViews';
import { useAuth } from '@/src/auth/useAuth';
import { compileCompositionSpec } from '@/src/lib/viewspec/compiler';
import { executeCompiledQuery } from '@/src/lib/viewspec/executor';
import { registry } from '@/src/lib/viewspec/registry';
import { ValidationError } from '@/src/lib/viewspec/types';
import type { CompiledPanel, CompositionSpec } from '@/src/lib/viewspec/types';
import { ChartFrame } from '@/src/components/dashboard/ChartFrame';
import { DashGrid, DashPageHead } from '@/src/components/dashboard/layout';
import { ListState } from '@/src/components/ui/ListState';
import { KPITile } from '@/src/components/ui/KPITile';
import type { IconName } from '@/src/components/ui/icons';

/** Maximum panels per view (OD-9, FR-VR-010 extension). */
const MAX_PANELS_PER_VIEW = 20;

export interface UserViewRendererProps {
  /** Optional: if provided, overrides the :viewId route param (for tests). */
  viewId?: string;
}

// ── Per-panel state ───────────────────────────────────────────────────────────

interface PanelState {
  loading: boolean;
  data: unknown[] | null;
  error: Error | null;
}

// ── Primitive hydration (FR-VR-039) ───────────────────────────────────────────

/**
 * Resolves the kit primitive component and hydrates it with data + static props.
 * Defensive: unknown props are silently ignored; missing required props use defaults.
 */
function HydratedPrimitive({
  panel,
  data,
}: {
  panel: CompiledPanel;
  data: unknown[];
}) {
  const descriptor = registry.get(panel.primitive);
  if (!descriptor) {
    // Should never happen: compileCompositionSpec already validated the primitive.
    return null;
  }

  const props = panel.props ?? {};

  switch (panel.primitive) {
    case 'KPITile': {
      const row = data[0] as Record<string, unknown> | undefined;
      const alias = panel.compiledQuery.resolvedAggregate?.alias;
      const value = alias != null ? row?.[alias] : row?.[panel.compiledQuery.resolvedSelect[0]];
      return (
        <KPITile
          icon={((props.icon as IconName | undefined) ?? 'doc') as IconName}
          tone={(props.tone as 'blue' | 'violet' | 'amber' | 'red' | 'green' | undefined) ?? 'blue'}
          label={(props.label as string | undefined) ?? panel.id}
          value={value as React.ReactNode}
          negative={props.negative as boolean | undefined}
          help={props.help as string | undefined}
          vs={props.vs as string | undefined}
        />
      );
    }
    default:
      // For primitives not yet wired with a specific hydration case,
      // render the data as a JSON debug table (fallback for I3 scope).
      // TODO I4: wire remaining primitives (DataTable, StatTiles, Funnel, StatusBarChart, ProgressBar, Card)
      return (
        <pre className="overflow-auto rounded border border-border p-3 text-[12px]">
          {JSON.stringify(data, null, 2)}
        </pre>
      );
  }
}

// ── Main component ────────────────────────────────────────────────────────────

const UserViewRenderer: React.FC<UserViewRendererProps> = ({ viewId: viewIdProp }) => {
  const navigate = useNavigate();
  const params = useParams<{ viewId: string }>();
  // Accept prop (for tests) or fall back to route param
  const viewId = viewIdProp ?? params.viewId ?? '';

  const { currentUser } = useAuth();
  const { data: view, isPending } = useUserView(viewId);

  // Per-panel query state (FR-VR-036..038, FR-VR-042)
  const [panelStates, setPanelStates] = useState<PanelState[]>([]);
  const [compiledPanels, setCompiledPanels] = useState<CompiledPanel[] | null>(null);
  const [specError, setSpecError] = useState<ValidationError | Error | null>(null);

  useEffect(() => {
    // Reset when viewId changes
    setCompiledPanels(null);
    setPanelStates([]);
    setSpecError(null);
  }, [viewId]);

  useEffect(() => {
    if (isPending || view === undefined) return;

    // not-found / archived (FR-VR-032, FR-VR-033)
    if (view === null || view.archived_at !== null) {
      setCompiledPanels(null);
      setSpecError(null);
      return;
    }

    // Panel count guard (OD-9)
    const rawSpec = view.spec as unknown;
    const specAsObj = rawSpec as { version?: unknown; panels?: unknown[] };
    if (Array.isArray(specAsObj?.panels) && specAsObj.panels.length > MAX_PANELS_PER_VIEW) {
      setSpecError(new Error(`This view exceeds the maximum of ${MAX_PANELS_PER_VIEW} panels.`));
      return;
    }

    // Compile (NFR-VR-SEC-004: always compile before execute)
    try {
      const ctx = { userId: currentUser!.id, orgId: currentUser!.org_id };
      const panels = compileCompositionSpec(rawSpec as CompositionSpec, ctx);
      setCompiledPanels(panels);
      setSpecError(null);

      // Initialize per-panel loading state (FR-VR-036)
      setPanelStates(panels.map(() => ({ loading: true, data: null, error: null })));

      // Fire all panel queries in parallel (FR-VR-042, NFR-VR-PERF-001)
      Promise.allSettled(
        panels.map((panel) => executeCompiledQuery(panel.compiledQuery))
      ).then((results) => {
        setPanelStates(
          results.map((r) =>
            r.status === 'fulfilled'
              ? { loading: false, data: r.value as unknown[], error: null }
              : { loading: false, data: null, error: r.reason as Error }
          )
        );
      });
    } catch (err) {
      setSpecError(err instanceof Error ? err : new Error(String(err)));
      setCompiledPanels(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, isPending, viewId]);

  // ── Loading state (FR-VR-031) ───────────────────────────────────────────
  if (isPending) {
    return (
      <div className="flex flex-col gap-6 p-6">
        {/* DashPageHead skeleton */}
        <div aria-hidden="true" className="skel h-8 w-1/3 rounded" />
        {/* ChartFrame loading placeholders */}
        <DashGrid>
          <ChartFrame state="loading">{null}</ChartFrame>
          <ChartFrame state="loading">{null}</ChartFrame>
        </DashGrid>
      </div>
    );
  }

  // ── Not-found / no-access / archived (FR-VR-032, FR-VR-033, OD-1) ─────
  if (view === null || view === undefined || (view && view.archived_at !== null)) {
    return (
      <ListState
        variant="empty"
        title="This view was not found."
        sub="The view may have been removed, or you may not have access."
        action={{ label: 'Go to Dashboard', onClick: () => navigate('/') }}
      />
    );
  }

  // ── Spec-invalid / panel-count-exceeded (FR-VR-034, OD-2, OD-9) ────────
  if (specError !== null) {
    const isValidationError = specError instanceof ValidationError;
    return (
      <div className="flex flex-col gap-4 p-6">
        <ListState
          variant="error"
          title="This view's definition is invalid."
          sub="The view cannot be rendered because its specification is invalid."
        />
        {/* OD-2: dev/non-prod disclosure */}
        {import.meta.env.VITE_APP_ENV !== 'production' && isValidationError && (
          <details className="rounded border border-border p-3 text-[12px]">
            <summary className="cursor-pointer font-semibold text-muted-foreground">
              Developer detail (hidden in production)
            </summary>
            <pre className="mt-2 overflow-auto">
              {`code: ${(specError as ValidationError).code}\ndetail: ${(specError as ValidationError).detail ?? '—'}\nmessage: ${specError.message}`}
            </pre>
          </details>
        )}
        {specError.message.includes(`maximum of ${MAX_PANELS_PER_VIEW}`) && (
          <p className="text-[13px] text-muted-foreground">{specError.message}</p>
        )}
      </div>
    );
  }

  // ── Empty spec (FR-VR-035, OD-3) ────────────────────────────────────────
  if (compiledPanels !== null && compiledPanels.length === 0) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <DashPageHead title={view.name} sub={view.description ?? ''} />
        {/* TODO I4: add CTA to open builder */}
        <ListState
          variant="empty"
          title="This view has no panels yet."
        />
      </div>
    );
  }

  // ── Ready: render compiled panels (FR-VR-036..042) ─────────────────────
  if (compiledPanels === null || panelStates.length === 0) {
    // Still compiling or state not yet initialized — show skeleton
    return (
      <div className="flex flex-col gap-6 p-6">
        <div aria-hidden="true" className="skel h-8 w-1/3 rounded" />
        <DashGrid>
          <ChartFrame state="loading">{null}</ChartFrame>
        </DashGrid>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <DashPageHead title={view.name} sub={view.description ?? ''} />
      {/* NFR-VR-A11Y-002: DashGrid is inside the shell's <main>; panels use correct heading hierarchy */}
      <DashGrid>
        {compiledPanels.map((panel, idx) => {
          const state = panelStates[idx] ?? { loading: true, data: null, error: null };
          const data = state.data ?? [];
          const colSpan = panel.layout?.colSpan;
          const panelStyle = colSpan ? { gridColumn: `span ${colSpan}` } : undefined;

          return (
            <div key={panel.id} style={panelStyle}>
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
                onRetry={() => {
                  // Per-panel retry (FR-VR-038)
                  setPanelStates((prev) => {
                    const next = [...prev];
                    next[idx] = { loading: true, data: null, error: null };
                    return next;
                  });
                  executeCompiledQuery(panel.compiledQuery).then(
                    (rows) => {
                      setPanelStates((prev) => {
                        const next = [...prev];
                        next[idx] = { loading: false, data: rows as unknown[], error: null };
                        return next;
                      });
                    },
                    (err: Error) => {
                      setPanelStates((prev) => {
                        const next = [...prev];
                        next[idx] = { loading: false, data: null, error: err };
                        return next;
                      });
                    }
                  );
                }}
              >
                <HydratedPrimitive panel={panel} data={data} />
              </ChartFrame>
            </div>
          );
        })}
      </DashGrid>
    </div>
  );
};

export default UserViewRenderer;
