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
 *            react-router (for navigate in OD-1 CTA and useParams for route).
 *   Does NOT import from src/lib/db/* directly.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/src/components/ui';
import { useUserView } from '@/src/hooks/useUserViews';
import { useAuth } from '@/src/auth/useAuth';
import { useOptionalRealRole } from '@/src/auth/impersonation';
import { useListReturn } from '@/src/hooks/useListReturn';
import { compileCompositionSpec } from '@/src/lib/viewspec/compiler';
import { executeCompiledQuery } from '@/src/lib/viewspec/executor';
import { ValidationError } from '@/src/lib/viewspec/types';
import type { CompiledPanel, CompositionSpec } from '@/src/lib/viewspec/types';
import { ChartFrame } from '@/src/components/dashboard/ChartFrame';
import { DashGrid } from '@/src/components/dashboard/layout';
import { ListState } from '@/src/components/ui/ListState';
import { HydratedPrimitive } from '@/src/components/dashboard/HydratedPrimitive';

// Re-export HydratedPrimitive so any relative importers/tests using UserViewRenderer
// as the import source continue to resolve without breakage (FR-CV-013 D5).
export { HydratedPrimitive };

/** Maximum panels per view (OD-9, FR-VR-010 extension). */
const MAX_PANELS_PER_VIEW = 20;

/** Local title/scope adapter; the shared shell frame can replace this without touching panels. */
const SavedViewHeader: React.FC<{
  title: string;
  description?: string | null;
  scope?: string;
  actions?: React.ReactNode;
  onBack: () => void;
}> = ({ title, description, scope, actions, onBack }) => {
  const { t } = useTranslation();
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <Button variant="ghost" className="mb-2 min-h-11 px-2" onClick={onBack}>
          {t('viewRenderer.backToViews', 'Back to saved views')}
        </Button>
        <h1 className="text-[24px] font-bold leading-tight tracking-[-0.02em]">{title}</h1>
        {(scope || description) && (
          <p className="mt-1 max-w-[68ch] text-sm text-muted-foreground">
            {[scope, description].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
};

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

// ── Main component ────────────────────────────────────────────────────────────

const UserViewRenderer: React.FC<UserViewRendererProps> = ({ viewId: viewIdProp }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams<{ viewId: string }>();
  // Accept prop (for tests) or fall back to route param
  const viewId = viewIdProp ?? params.viewId ?? '';
  const { returnToList } = useListReturn({ list: 'views' });
  const backToViews = () => returnToList();

  const { currentUser } = useAuth();
  const realRole = useOptionalRealRole();
  const { data: view, isPending, isError, refetch } = useUserView(viewId);
  const canManageView = Boolean(view && (view.user_id === currentUser?.id || realRole === 'Admin'));
  const scopeLabel = view?.scope === 'shared_org'
    ? t('viewRenderer.sharedScope', 'Shared with your organisation')
    : t('viewRenderer.privateScope', 'Private');

  // Per-panel query state (FR-VR-036..038, FR-VR-042)
  const [panelStates, setPanelStates] = useState<PanelState[]>([]);
  const [compiledPanels, setCompiledPanels] = useState<CompiledPanel[] | null>(null);
  const [specError, setSpecError] = useState<ValidationError | Error | null>(null);
  // `compiling` is true from when view data arrives until compiledPanels or specError is set.
  // Merged with isPending in the loading guard so we never show a FOUC between the two
  // skeleton variants (view-loading skeleton vs. still-compiling skeleton).
  const [compiling, setCompiling] = useState(false);

  useEffect(() => {
    // Reset when viewId changes
    setCompiledPanels(null);
    setPanelStates([]);
    setSpecError(null);
    setCompiling(false);
  }, [viewId]);

  useEffect(() => {
    if (isPending || view === undefined) return;

    // not-found / archived (FR-VR-032, FR-VR-033)
    if (view === null || view.archived_at !== null) {
      setCompiledPanels(null);
      setSpecError(null);
      setCompiling(false);
      return;
    }

    // Null guard: currentUser may be null during reauthentication or session expiry.
    // This mirrors the pattern used elsewhere in the codebase (e.g. project detail effects).
    if (!currentUser) return;

    // Mark compilation in-flight so the unified skeleton stays visible (no FOUC).
    setCompiling(true);

    // Panel count guard (OD-9)
    const rawSpec = view.spec as unknown;
    const specAsObj = rawSpec as { version?: unknown; panels?: unknown[] };
    if (Array.isArray(specAsObj?.panels) && specAsObj.panels.length > MAX_PANELS_PER_VIEW) {
      setSpecError(new Error(`This view exceeds the maximum of ${MAX_PANELS_PER_VIEW} panels.`));
      setCompiling(false);
      return;
    }

    // Compile (NFR-VR-SEC-004: always compile before execute)
    let cancelled = false;
    try {
      const ctx = { userId: currentUser.id, orgId: currentUser.org_id };
      const panels = compileCompositionSpec(rawSpec as CompositionSpec, ctx);
      setCompiledPanels(panels);
      setSpecError(null);
      setCompiling(false);

      // Initialize per-panel loading state (FR-VR-036)
      setPanelStates(panels.map(() => ({ loading: true, data: null, error: null })));

      // Fire all panel queries in parallel (FR-VR-042, NFR-VR-PERF-001)
      Promise.allSettled(
        panels.map((panel) => executeCompiledQuery(panel.compiledQuery))
      ).then((results) => {
        // Guard against stale updates when the view or viewId changed while
        // queries were in-flight (prevents overwriting a newer view's panel states).
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
    } catch (err) {
      setSpecError(err instanceof Error ? err : new Error(String(err)));
      setCompiledPanels(null);
      setCompiling(false);
    }

    return () => {
      cancelled = true;
    };
  }, [view, isPending, viewId, currentUser]);

  // ── Loading / compiling skeleton (FR-VR-031) ───────────────────────────
  // Unified: covers both the initial useUserView fetch and the brief compile tick
  // (view resolved → compiledPanels resolves). A single skeleton avoids the FOUC
  // that arose when the "still compiling" branch rendered a structurally different
  // skeleton without a heading (design-review finding, I3).
  // §7 skel pattern: two-line DashPageHead placeholder (title + sub), matching the
  // real DashPageHead's h1 + p layout so the page doesn't jump on ready.
  if (isPending || compiling) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <SavedViewHeader
          title={t('viewRenderer.loadingTitle', 'Opening saved view')}
          description={t('viewRenderer.loadingDescription', 'Loading the saved answer and its panels…')}
          onBack={backToViews}
        />
        <div aria-hidden="true" className="flex flex-col gap-1">
          <div className="skel skel-line w-3/5" />
        </div>
        <DashGrid>
          <div className="min-[920px]:col-span-2"><ChartFrame state="loading">{null}</ChartFrame></div>
        </DashGrid>
      </div>
    );
  }

  // ── Network / fetch error (AC-VR-019) ───────────────────────────────────
  // When useUserView returns isError=true the data is undefined. Without this guard
  // the renderer falls through to the not-found state — indistinguishable from a
  // genuine RLS null and offers no retry affordance (design-review finding, I3).
  if (isError) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <SavedViewHeader
          title={t('viewRenderer.savedViewTitle', 'Saved view')}
          onBack={backToViews}
        />
        <ListState
          variant="error"
          title={t('viewRenderer.loadErrorTitle', 'Could not load saved view')}
          sub={t('viewRenderer.loadErrorDescription', 'The saved answer did not load. Retry or return to saved views.')}
          onRetry={() => void refetch()}
        />
      </div>
    );
  }

  // The query may resolve before the session profile is ready (for example during
  // reauthentication). Keep the state generic until the viewer identity is known so
  // a private view name never flashes to a signed-out or unresolved session.
  if (!currentUser && view) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <SavedViewHeader
          title={t('viewRenderer.checkingAccessTitle', 'Checking access to saved view')}
          description={t('viewRenderer.checkingAccessDescription', 'Confirming your access before opening this saved answer…')}
          onBack={backToViews}
        />
        <DashGrid>
          <div className="min-[920px]:col-span-2"><ChartFrame state="loading">{null}</ChartFrame></div>
        </DashGrid>
      </div>
    );
  }

  // ── Not-found / no-access / archived (FR-VR-032, FR-VR-033, OD-1) ─────
  if (view === null || view === undefined || (view && view.archived_at !== null)) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <SavedViewHeader title={t('viewRenderer.savedViewTitle', 'Saved view')} onBack={backToViews} />
        <ListState
          variant="empty"
          title={t('viewRenderer.notFoundTitle', 'View not found')}
          sub={t('viewRenderer.notFoundDescription', 'This saved answer is unavailable. It may have been archived or you may not have access.')}
        />
      </div>
    );
  }

  // ── Spec-invalid / panel-count-exceeded (FR-VR-034, OD-2, OD-9) ────────
  if (specError !== null) {
    const isValidationError = specError instanceof ValidationError;
    return (
      <div className="flex flex-col gap-4 p-6">
        <SavedViewHeader title={view.name} description={view.description} scope={scopeLabel} onBack={backToViews} />
        <ListState
          variant="error"
          title={t('viewRenderer.invalidTitle', 'This saved view cannot be shown')}
          sub={t('viewRenderer.invalidDescription', 'Its saved definition could not be interpreted.')}
        />
        {/* OD-2: dev/non-prod disclosure — VITE_APP_ENV=prod in production (docs/environments.md §3) */}
        {import.meta.env.VITE_APP_ENV !== 'prod' && isValidationError && (
          <details className="rounded border border-border p-3 text-[12px]">
            <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-muted-foreground">
              {t('viewRenderer.developerDetail', 'Developer detail (hidden in production)')}
            </summary>
            <pre className="mt-2 overflow-auto">
              {`code: ${(specError as ValidationError).code}\ndetail: ${(specError as ValidationError).detail ?? '—'}\nmessage: ${specError.message}`}
            </pre>
          </details>
        )}
        {specError.message.includes(`maximum of ${MAX_PANELS_PER_VIEW}`) && (
          <p className="text-[13px] text-muted-foreground">{t('viewRenderer.maximumPanels', 'This view has more than {{count}} panels.', { count: MAX_PANELS_PER_VIEW })}</p>
        )}
      </div>
    );
  }

  // ── Empty spec (FR-VR-035, OD-3) ────────────────────────────────────────
  if (compiledPanels !== null && compiledPanels.length === 0) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <SavedViewHeader
          title={view.name}
          description={view.description}
          scope={scopeLabel}
          onBack={backToViews}
          actions={canManageView ? (
            <Button variant="primary" className="min-h-11" onClick={() => navigate(`/views/${view.id}/edit`)}>
              {t('viewRenderer.editView', 'Edit view')}
            </Button>
          ) : undefined}
        />
        <ListState
          variant="empty"
          title={t('viewRenderer.emptyTitle', 'This saved view has no panels yet')}
          sub={canManageView
            ? t('viewRenderer.emptyOwnerDescription', 'Add a panel to define the answer this view should save.')
            : t('viewRenderer.emptyReaderDescription', 'Ask the owner to add panels to this saved answer.')}
        />
      </div>
    );
  }

  // ── Ready: render compiled panels (FR-VR-036..042) ─────────────────────
  // compiledPanels is guaranteed non-null here: the empty-spec guard above handles
  // compiledPanels.length === 0, and the loading/compiling guard above covers the
  // null / still-initializing case. The panelStates.length check is a safety net
  // in case of a React render cycle race.
  if (!compiledPanels || panelStates.length === 0) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <SavedViewHeader
          title={view.name}
          description={view.description}
          scope={scopeLabel}
          onBack={backToViews}
        />
        <DashGrid>
          <div className="min-[920px]:col-span-2"><ChartFrame state="loading">{null}</ChartFrame></div>
        </DashGrid>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <SavedViewHeader
        title={view.name}
        description={view.description}
        scope={scopeLabel}
        onBack={backToViews}
        actions={canManageView ? (
          <Button variant="outline" className="min-h-11" onClick={() => navigate(`/views/${view.id}/edit`)}>
            {t('viewRenderer.editView', 'Edit view')}
          </Button>
        ) : undefined}
      />
      {/* NFR-VR-A11Y-002: DashGrid is inside the shell's <main>; panels use correct heading hierarchy */}
      <DashGrid>
        {compiledPanels.map((panel, idx) => {
          const state = panelStates[idx] ?? { loading: true, data: null, error: null };
          const data = state.data ?? [];
          const colSpan = compiledPanels.length === 1 ? 2 : panel.layout?.colSpan;
          const panelStyle = colSpan ? { gridColumn: `span ${colSpan}` } : undefined;

          return (
            <div key={panel.id} style={panelStyle} className="rounded-lg border border-border bg-card p-4">
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
