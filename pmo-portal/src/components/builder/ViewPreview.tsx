/**
 * ViewPreview — in-memory preview component (I4, OD-VB-6, FR-VB-050..054).
 *
 * Accepts a `CompositionSpec` prop directly (no DB row, no useUserView fetch).
 * Compiles each panel's querySpec independently via compileQuerySpec (not
 * compileCompositionSpec) so valid panels render while the one being configured
 * may show an inline error callout (OD-VB-7, FR-VB-054).
 *
 * Uses executeCompiledQuery for data fetching — same executor as UserViewRenderer (I3).
 * Each panel runs as a cached query (keyed by panel id + query), so editing one panel leaves the others cached.
 *
 * Layering: imports src/lib/viewspec/* and src/auth/useAuth only (NFR-VB-LAYER-002).
 * Does NOT import from src/lib/db/* or src/lib/repositories.
 */
import React, { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/auth/useAuth';
import { compileQuerySpec } from '@/src/lib/viewspec/compiler';
import { executeCompiledQuery } from '@/src/lib/viewspec/executor';
import { registry } from '@/src/lib/viewspec/registry';
import { ValidationError } from '@/src/lib/viewspec/types';
import type { CompiledPanel, CompiledQuery, CompositionSpec } from '@/src/lib/viewspec/types';
import { ChartFrame } from '@/src/components/dashboard/ChartFrame';
import { DashGrid } from '@/src/components/dashboard/layout';
import { HydratedPrimitive } from '@/src/components/dashboard/HydratedPrimitive';

// ── Per-panel state ───────────────────────────────────────────────────────────

interface PreviewPanelState {
  loading: boolean;
  data: unknown[];
  error: Error | null;
  compileError: ValidationError | null;
  compiledQuery: CompiledQuery | null;
}

// ── Primitive hydration ───────────────────────────────────────────────────────
// All supported dashboard primitives use the same hydration path as saved views.

function PreviewPrimitive({ panel, data }: { panel: CompiledPanel; data: unknown[] }) {
  if (!registry.get(panel.primitive)) return null;
  return <HydratedPrimitive panel={panel} data={data} />;
}

// ── Main component ────────────────────────────────────────────────────────────

export interface ViewPreviewProps {
  spec: CompositionSpec;
}

const ViewPreview: React.FC<ViewPreviewProps> = ({ spec }) => {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const userId = currentUser?.id;
  const orgId = currentUser?.org_id;

  // Per-panel compile (independent — valid panels show while invalid ones show errors).
  // Keyed on the panels' content, so an equal spec from a new render neither recompiles nor refetches.
  const panelsKey = JSON.stringify(spec.panels.map((p) => [p.id, p.querySpec]));
  const compiledEntries = useMemo(() => {
    if (!userId || !orgId) return [];
    const ctx = { userId, orgId };
    return spec.panels.map((panel) => {
      try {
        return { compiledQuery: compileQuerySpec(panel.querySpec, ctx) as CompiledQuery | null, compileError: null as ValidationError | null };
      } catch (err) {
        return {
          compiledQuery: null as CompiledQuery | null,
          compileError: err instanceof ValidationError ? err : new ValidationError('UNKNOWN_ENTITY', String(err)),
        };
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- panelsKey is the content identity of spec.panels
  }, [panelsKey, userId, orgId]);

  // One cached query per panel: an unchanged panel hits the cache when another panel is edited.
  const results = useQueries({
    queries: compiledEntries.map((entry, idx) => ({
      queryKey: ['view-preview', orgId, userId, spec.panels[idx]?.id, spec.panels[idx]?.querySpec],
      queryFn: () => executeCompiledQuery(entry.compiledQuery as CompiledQuery) as Promise<unknown[]>,
      enabled: entry.compiledQuery !== null,
      staleTime: 30_000,
      retry: false,
    })),
  });
  const panelStates: PreviewPanelState[] = compiledEntries.map((entry, idx) => {
    const q = results[idx];
    return {
      loading: entry.compileError === null && (q === undefined || q.isPending || (q.isError && q.isFetching)),
      data: q?.data ?? [],
      error: q?.isError ? (q.error instanceof Error ? q.error : new Error(String(q.error))) : null,
      compileError: entry.compileError,
      compiledQuery: entry.compiledQuery,
    };
  });
  const retryPanel = (index: number) => { void results[index]?.refetch(); };

  // Empty spec placeholder (FR-VB-051)
  if (spec.panels.length === 0) {
    return (
      <div className="flex min-h-[200px] items-center justify-center rounded-lg border border-dashed border-border p-6 text-[13px] text-muted-foreground">
        {t('viewBuilder.previewEmpty', 'Your preview will appear here once you add a panel.')}
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
        const panelStyle = spec.panels.length === 1 ? { gridColumn: '1 / -1' } : colSpan ? { gridColumn: `span ${colSpan}` } : undefined;

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
                {t('viewBuilder.previewUnavailable', 'Preview unavailable:')} {state.compileError.code}
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
            className="min-w-0"
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
              onRetry={() => retryPanel(idx)}
            >
              <PreviewPrimitive panel={compiledPanel} data={state.data} />
            </ChartFrame>
          </div>
        );
      })}
    </DashGrid>
  );
};

export default ViewPreview;
