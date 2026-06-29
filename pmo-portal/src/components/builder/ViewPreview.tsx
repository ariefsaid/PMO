/**
 * ViewPreview — in-memory preview component (I4, OD-VB-6, FR-VB-050..054).
 *
 * Accepts a `CompositionSpec` prop directly (no DB row, no useUserView fetch).
 * Compiles each panel's querySpec independently via compileQuerySpec (not
 * compileCompositionSpec) so valid panels render while the one being configured
 * may show an inline error callout (OD-VB-7, FR-VB-054).
 *
 * Uses executeCompiledQuery for data fetching — same executor as UserViewRenderer (I3).
 * Generation-counter pattern prevents stale state updates in React 19's concurrent mode.
 *
 * Layering: imports src/lib/viewspec/* and src/auth/useAuth only (NFR-VB-LAYER-002).
 * Does NOT import from src/lib/db/* or src/lib/repositories.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/src/auth/useAuth';
import { compileQuerySpec } from '@/src/lib/viewspec/compiler';
import { executeCompiledQuery } from '@/src/lib/viewspec/executor';
import { registry } from '@/src/lib/viewspec/registry';
import { ValidationError } from '@/src/lib/viewspec/types';
import type { CompiledPanel, CompiledQuery, CompositionSpec } from '@/src/lib/viewspec/types';
import { ChartFrame } from '@/src/components/dashboard/ChartFrame';
import { DashGrid } from '@/src/components/dashboard/layout';
import { KPITile } from '@/src/components/ui/KPITile';
import type { IconName } from '@/src/components/ui/icons';

// ── Per-panel state ───────────────────────────────────────────────────────────

interface PreviewPanelState {
  loading: boolean;
  data: unknown[];
  error: Error | null;
  compileError: ValidationError | null;
  compiledQuery: CompiledQuery | null;
}

// ── HydratedPrimitive (duplicated from UserViewRenderer — see design notes) ───
// Duplication is deliberate: extracting into shared lib would force a React import
// into src/lib/viewspec/ (layering violation). 30-line surface; delta risk is minimal.

function HydratedPrimitive({ panel, data }: { panel: CompiledPanel; data: unknown[] }) {
  const descriptor = registry.get(panel.primitive);
  if (!descriptor) return null;
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
      return (
        <pre className="overflow-auto rounded p-3 text-[12px]">
          {JSON.stringify(data, null, 2)}
        </pre>
      );
  }
}

// ── Main component ────────────────────────────────────────────────────────────

export interface ViewPreviewProps {
  spec: CompositionSpec;
}

const ViewPreview: React.FC<ViewPreviewProps> = ({ spec }) => {
  const { currentUser } = useAuth();
  const [panelStates, setPanelStates] = useState<PreviewPanelState[]>([]);
  // Generation counter: incremented on each spec/user change so stale async
  // callbacks can detect they've been superseded and silently drop their result.
  // This avoids orphaned Promises in React 19's act() queue.
  const genRef = useRef(0);

  useEffect(() => {
    if (!currentUser || spec.panels.length === 0) {
      // Stable empty update — avoid creating a new [] reference on each render
      // (which would re-trigger the effect and cause an infinite loop)
      setPanelStates((prev) => (prev.length === 0 ? prev : []));
      return;
    }

    const gen = ++genRef.current;
    const ctx = { userId: currentUser.id, orgId: currentUser.org_id };

    // Per-panel compile (independent — valid panels show while invalid ones show errors)
    const compiledEntries = spec.panels.map((panel) => {
      try {
        const compiledQuery = compileQuerySpec(panel.querySpec, ctx);
        return { compiledQuery, panel, compileError: null as ValidationError | null };
      } catch (err) {
        return {
          compiledQuery: null as CompiledQuery | null,
          panel,
          compileError:
            err instanceof ValidationError
              ? err
              : new ValidationError('UNKNOWN_ENTITY', String(err)),
        };
      }
    });

    // Initialize all panels as loading (store compiledQuery in state so render body
    // doesn't need to re-compile on every render)
    setPanelStates(
      compiledEntries.map((e) => ({
        loading: e.compileError === null,
        data: [],
        error: null,
        compileError: e.compileError,
        compiledQuery: e.compiledQuery,
      })),
    );

    // Fire queries for panels that compiled successfully
    compiledEntries.forEach((entry, idx) => {
      if (entry.compileError !== null || entry.compiledQuery === null) return;
      const compiledQuery = entry.compiledQuery;
      void executeCompiledQuery(compiledQuery).then(
        (rows) => {
          if (genRef.current !== gen) return; // stale, discard
          setPanelStates((prev) => {
            const next = [...prev];
            next[idx] = {
              loading: false,
              data: rows as unknown[],
              error: null,
              compileError: null,
              compiledQuery,
            };
            return next;
          });
        },
        (err: Error) => {
          if (genRef.current !== gen) return; // stale, discard
          setPanelStates((prev) => {
            const next = [...prev];
            next[idx] = {
              loading: false,
              data: [],
              error: err,
              compileError: null,
              compiledQuery,
            };
            return next;
          });
        },
      );
    });

    return () => {
      // Invalidate this generation so in-flight callbacks are discarded
      genRef.current = gen + 1;
    };
  }, [spec, currentUser]);

  // Empty spec placeholder (FR-VB-051)
  if (spec.panels.length === 0) {
    return (
      <div className="flex min-h-[200px] items-center justify-center rounded-lg border border-dashed border-border p-6 text-[13px] text-muted-foreground">
        Your preview will appear here once you add a panel.
      </div>
    );
  }

  return (
    <DashGrid>
      {spec.panels.map((panel, idx) => {
        const state = panelStates[idx] ?? {
          loading: true,
          data: [],
          error: null,
          compileError: null,
          compiledQuery: null,
        };
        const colSpan = panel.layout?.colSpan;
        const panelStyle = colSpan ? { gridColumn: `span ${colSpan}` } : undefined;

        // Per-panel compile error callout (OD-VB-7, FR-VB-054)
        if (state.compileError) {
          return (
            <div
              key={panel.id}
              style={panelStyle}
              className="rounded-lg border border-border bg-card p-4"
            >
              <div
                role="status"
                className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800"
              >
                Preview unavailable: {state.compileError.code}
                {state.compileError.detail ? ` — ${state.compileError.detail}` : ''}
              </div>
            </div>
          );
        }

        // Use the compiled query stored in state (avoids re-compiling on every render)
        const compiledQuery = state.compiledQuery;
        if (!compiledQuery) {
          return null;
        }

        const compiledPanel: CompiledPanel = {
          id: panel.id,
          primitive: panel.primitive,
          compiledQuery,
          ...(panel.layout !== undefined && { layout: panel.layout }),
          ...(panel.props !== undefined && { props: panel.props }),
        };

        return (
          <div
            key={panel.id}
            style={panelStyle}
            className="rounded-lg border border-border bg-card p-4"
          >
            <ChartFrame
              state={
                state.loading
                  ? 'loading'
                  : state.error
                    ? 'error'
                    : state.data.length === 0
                      ? 'empty'
                      : 'ready'
              }
              emptyTitle={(panel.props?.emptyTitle as string | undefined) ?? 'No data'}
            >
              <HydratedPrimitive panel={compiledPanel} data={state.data} />
            </ChartFrame>
          </div>
        );
      })}
    </DashGrid>
  );
};

export default ViewPreview;
