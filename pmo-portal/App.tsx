import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/src/lib/queryClient';
import { LoadingFallback } from './components/LoadingFallback';
import { AuthProvider } from '@/src/auth/AuthProvider';
import { RequireAuth } from '@/src/auth/RequireAuth';
import { AnalyticsProvider } from '@/src/lib/analytics';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ImpersonationBanner } from '@/src/auth/ImpersonationBanner';
import { useAuth } from '@/src/auth/useAuth';
import LoginPage from '@/src/auth/LoginPage';
import {
  AppShell,
  Rail,
  ContextBar,
  CommandPalette,
  modulesForRole,
  breadcrumbForPath,
  recordLabelForPath,
  recordStatusGroupForPath,
  deriveRailActiveOverride,
} from '@/src/components/shell';
import type { PaletteItem } from '@/src/components/shell';
import type { BreadcrumbPart } from '@/src/components/shell';
import { useProjects } from '@/src/hooks/useProjects';
import { useProcurements } from '@/src/hooks/useProcurements';
import { useIncidents } from '@/src/hooks/useIncidents';
import { useCompanies } from '@/src/hooks/useCompanies';
import { useContacts } from '@/src/hooks/useContacts';
import { useSalesPipeline, useLostDeals } from '@/src/hooks/useDashboard';
import { useRecordSearch } from '@/src/hooks/useRecordSearch';
import { useOptionalRealRole } from '@/src/auth/impersonation';
import { UserRole } from './types';
import { ToastProvider } from '@/src/components/ui';
import { EnvBadge } from '@/src/components/EnvBadge';
import { FeatureRoute } from '@/src/components/FeatureRoute';
import { useUserViews } from '@/src/hooks/useUserViews';
import { isFeatureEnabled } from '@/src/lib/features';
import { buildViewsPaletteItems } from '@/src/lib/viewspec/paletteItems';
// A2 (ADR-0040): AssistantPanel + provider + hotkey — flag-gated, absent when off.
import { AgentRuntimeProvider } from '@/src/lib/agent/runtime/AgentRuntimeProvider';
import { useAgentRuntimeContext } from '@/src/lib/agent/runtime/AgentRuntimeContext';
import { AssistantPanel } from '@/src/components/panel/AssistantPanel';
import { useAssistantHotkey } from '@/src/hooks/useAssistantHotkey';

// ── Lazy route chunks ──────────────────────────────────────────────────────
const ExecutiveDashboard = React.lazy(() => import('./pages/ExecutiveDashboard'));
const Projects = React.lazy(() => import('./pages/Projects'));
const ProjectDetail = React.lazy(() => import('./pages/project-detail/ProjectDetail'));
const SalesPipeline = React.lazy(() => import('./pages/SalesPipeline'));
const ProcurementPage = React.lazy(() => import('./pages/Procurement'));
const ProcurementDetails = React.lazy(() => import('./pages/ProcurementDetails'));
const TimesheetsPage = React.lazy(() => import('./pages/Timesheets'));
const ApprovalsPage = React.lazy(() => import('./pages/Approvals'));
const CompaniesPage = React.lazy(() => import('./pages/Companies'));
const CompanyDetailPage = React.lazy(() => import('./pages/CompanyDetail'));
const ContactsPage = React.lazy(() => import('./pages/Contacts'));
const ContactDetailPage = React.lazy(() => import('./pages/ContactDetail'));
const IncidentsPage = React.lazy(() => import('./pages/Incidents'));
const IncidentDetailPage = React.lazy(() => import('./pages/IncidentDetail'));
const AdminUsersPage = React.lazy(() => import('./pages/AdminUsers'));
const PlaceholderPage = React.lazy(() => import('./pages/PlaceholderPage'));
const MyTasksPage = React.lazy(() => import('./pages/MyTasks'));
const NotFoundPage = React.lazy(() => import('./pages/NotFound'));
const UserViewRenderer = React.lazy(() => import('./pages/UserViewRenderer'));
const MyViewsPage = React.lazy(() => import('./pages/MyViewsPage'));
const ViewBuilderPage = React.lazy(() => import('./pages/ViewBuilderPage'));

/**
 * Model B (ADR-0020, AC-IXD-PROJ-002): the legacy `/sales/:opportunityId` deep link redirects
 * (replace) to the ONE canonical detail route `/projects/:opportunityId`. `:opportunityId` IS
 * the `projects.id`, so no id translation. Kept as a transitional route so old links + any cached
 * ⌘K rows still resolve; once external links are confirmed migrated it can be dropped.
 */
const SalesDetailRedirect: React.FC = () => {
  const { opportunityId = '' } = useParams<{ opportunityId: string }>();
  return <Navigate to={`/projects/${opportunityId}`} replace />;
};

export const AppRoutes: React.FC = () => (
  <Suspense fallback={<LoadingFallback />}>
    <Routes>
      <Route path="/" element={<ExecutiveDashboard />} />
      <Route path="/projects" element={<Projects />} />
      {/* B-9 (AC-W2-IA-004): /projects/:id/:tab? — all five tabs are now deep-linkable
          symmetrically. The old /projects/:id/budget special-case is subsumed by this
          (budget is just another :tab value). Both routes render ProjectDetail; the
          component reads :tab from params and defaults to 'overview' for unknown values.
          A backward-compat alias keeps old /budget links working. */}
      <Route path="/projects/:projectId/:tab" element={<ProjectDetail />} />
      <Route path="/projects/:projectId" element={<ProjectDetail />} />
      <Route path="/sales" element={<SalesPipeline />} />
      {/* Model B: the canonical detail route is /projects/:id; /sales/:id redirects there. */}
      <Route path="/sales/:opportunityId" element={<SalesDetailRedirect />} />
      <Route path="/procurement" element={<ProcurementPage />} />
      {/* Tabbed record shell (mirrors /projects/:id/:tab). The bare /procurement/:id
          keeps working (defaults to the Overview tab); :tab deep-links a panel. */}
      <Route path="/procurement/:procurementId" element={<ProcurementDetails />} />
      <Route path="/procurement/:procurementId/:tab" element={<ProcurementDetails />} />
      <Route path="/timesheets" element={<TimesheetsPage />} />
      <Route path="/approvals" element={<ApprovalsPage />} />
      <Route path="/companies" element={<CompaniesPage />} />
      {/* CW-4b: /companies/:id — the routable Company record page (retires the drawer-as-record). */}
      <Route path="/companies/:companyId" element={<CompanyDetailPage />} />
      <Route path="/contacts" element={<ContactsPage />} />
      {/* CW-4b: /contacts/:id — the routable Contact record page (retires the drawer-as-record). */}
      <Route path="/contacts/:contactId" element={<ContactDetailPage />} />
      {/* Incidents is hidden behind the interim `incidents` UI feature flag (UI-hide-first):
          <FeatureRoute> renders the page when enabled, else redirects deep-links to home
          instead of 404. Flip the flag in src/lib/features.ts to re-enable. CW-4a: /incidents/:id
          is the routable Incident detail page (fixes the dead-end) when the module is on. */}
      <Route path="/incidents" element={<FeatureRoute feature="incidents" element={<IncidentsPage />} />} />
      <Route
        path="/incidents/:incidentId"
        element={<FeatureRoute feature="incidents" element={<IncidentDetailPage />} />}
      />
      {/* /work-orders removed (owner decision — the route, not just the nav). */}
      {/* /tasks removed — real Tasks CRUD lives in the project Tasks tab. */}
      {/* B-1 (AC-W2-IXD-001/002): My Tasks — IC-scoped own-assigned cross-project task list. */}
      <Route path="/my-tasks" element={<MyTasksPage />} />
      <Route path="/reports" element={<PlaceholderPage title="Reports" />} />
      <Route path="/administration" element={<AdminUsersPage />} />
      {/* I4: My Views list (/views) — before /:viewId to avoid wildcard collision */}
      <Route
        path="/views"
        element={<FeatureRoute feature="userViews" element={<MyViewsPage />} />}
      />
      {/* I4: Create builder — literal 'new' before /:viewId param */}
      <Route
        path="/views/new"
        element={<FeatureRoute feature="userViews" element={<ViewBuilderPage mode="create" />} />}
      />
      {/* I4: Edit builder — /:viewId/edit is more specific than /:viewId alone */}
      <Route
        path="/views/:viewId/edit"
        element={<FeatureRoute feature="userViews" element={<ViewBuilderPage mode="edit" />} />}
      />
      {/* I3: User-view renderer: /views/:viewId (I3, FR-VR-050, FR-VR-051).
          FeatureRoute redirects to / when FEATURES.userViews is false.
          Declared after /views/new and /views/:viewId/edit to avoid wildcard collision. */}
      <Route
        path="/views/:viewId"
        element={<FeatureRoute feature="userViews" element={<UserViewRenderer />} />}
      />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  </Suspense>
);

// ── Shell chrome (inside the workspace provider + AgentRuntimeProvider) ───────
const ShellChrome: React.FC = () => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const paletteTriggerRef = useRef<HTMLElement | null>(null);

  // A2: Read panel open-state controls from AgentRuntimeProvider context.
  // These are stable callbacks (never change identity), safe to use here.
  const { togglePanel, openPanel, open: assistantOpen } = useAgentRuntimeContext();

  // A2: Register ⌘J / Ctrl+J global hotkey — flag-gated (FR-AP-004).
  useAssistantHotkey({
    enabled: isFeatureEnabled('agentAssistant'),
    onToggle: togglePanel,
  });

  // Cached index lists — already fetched by the index pages; read here only to
  // resolve a detail route's human record name for the breadcrumb (no new
  // query). The breadcrumb falls back to "Loading…" on a cold deep-link, never
  // a raw UUID — and to "Not found" once the relevant list has resolved without
  // the record (item I), never a perpetual "Loading…".
  const { data: projects, isPending: projectsPending } = useProjects();
  const { data: procurements, isPending: procurementsPending } = useProcurements();
  const { data: pipeline, isPending: pipelinePending } = useSalesPipeline();
  // Blocker 1 (AC-IXD-PROJ-005, ADR-0020 §4): a Loss-Tender deal opened at /projects/:id lives in
  // NEITHER the active-projects cache (excluded by the Wave-1 listProjects scoping) nor the open-
  // pipeline cache (get_sales_pipeline returns only the five open stages). Read the lost-deals list
  // (the same cache the Sales Pipeline shows in its "Lost" column) and UNION it into the
  // `opportunities` array threaded into the breadcrumb resolvers, so a lost record resolves to its
  // name + the Sales-Pipeline ancestry instead of "Projects > Not found".
  const { data: lostDeals, isPending: lostDealsPending } = useLostDeals();
  // CW-4a: the incident register backs the /incidents/:id breadcrumb's record name (its `type`).
  // Already fetched by the Incidents index; read here only to resolve the crumb (no new query).
  // Intentionally retained while the `incidents` feature flag hides the module (features.ts):
  // the /incidents routes redirect, so this branch is dormant — kept so re-enabling stays a
  // one-line flag flip rather than re-plumbing. Do NOT "tidy" it away.
  const { data: incidents, isPending: incidentsPending } = useIncidents();
  // CW-4b: the companies + contacts directories back the /companies/:id and /contacts/:id
  // breadcrumbs' record names. Already fetched by their index pages (and the ⌘K record search);
  // read here only to resolve the crumb (no new query).
  const { data: companies, isPending: companiesPending } = useCompanies();
  const { data: contacts, isPending: contactsPending } = useContacts();
  const { data: userViewsList, isPending: userViewsPending } = useUserViews();

  // ⌘K record search: index the three cached lists into Records rows that open
  // the matching detail route. Reads the same caches as the breadcrumb — no new
  // query. (AC-CMDK-001/003/004/005)
  const recordSearch = useRecordSearch(navigate);

  // Global ⌘K / Ctrl-K → open the command palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        paletteTriggerRef.current = document.activeElement as HTMLElement;
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const openPalette = useCallback(() => {
    paletteTriggerRef.current = document.activeElement as HTMLElement;
    setPaletteOpen(true);
  }, []);

  // Breadcrumb derives from the ROUTE (URL is the source of truth) — no tab
  // state. A detail route resolves its record name from the cached index lists;
  // a placeholder route reads its own page title; the module segment navigates
  // to its index. (AC-NAV-003/004/005)
  const breadcrumb = useMemo<BreadcrumbPart[]>(() => {
    // The pipeline partition the resolvers read = open pipeline ∪ lost deals (Blocker 1). A lost
    // deal is absent from both the open-pipeline cache and the active-projects cache, so it must be
    // unioned in here or its crumb resolves to "Projects > Not found".
    const opportunities = [...(pipeline?.projects ?? []), ...(lostDeals ?? [])];
    const recordLabel = recordLabelForPath(pathname, {
      projects,
      opportunities,
      procurements,
      incidents,
      companies,
      contacts,
      userViews: userViewsList?.map((v) => ({ id: v.id, name: v.name })),
    });
    // Model B (AC-IXD-PROJ-005): a /projects/:id detail crumb's ancestry follows the record's
    // STAGE — resolve its status group from the cached lists (the pipeline list carries pre-win
    // / lost rows that the active projects list no longer holds) and thread it in so a pipeline
    // record reads "Sales Pipeline > …" and an on-hand record reads "Projects > …".
    const recordStatusGroup = recordStatusGroupForPath(pathname, {
      projects,
      opportunities,
    });
    // The list that backs THIS detail route has settled (not pending) → an
    // unresolved record is a genuine not-found, so resolve the crumb to a
    // friendly label rather than a perpetual "Loading…". For /projects/:id the
    // record can live in ANY of the three caches (Model B: active projects, open
    // pipeline, or lost deals), so all must have settled before "Not found".
    // (recordStatusGroup, computed above, is also reused below to derive railActiveOverride — Option A.)
    const recordResolved =
      (pathname.startsWith('/projects/') &&
        !projectsPending &&
        !pipelinePending &&
        !lostDealsPending) ||
      (pathname.startsWith('/procurement/') && !procurementsPending) ||
      (pathname.startsWith('/incidents/') && !incidentsPending) ||
      (pathname.startsWith('/companies/') && !companiesPending) ||
      (pathname.startsWith('/contacts/') && !contactsPending) ||
      (pathname.startsWith('/sales/') && !pipelinePending) ||
      (pathname.startsWith('/views/') && !userViewsPending);  // I3 (FR-VR-053)
    return breadcrumbForPath(pathname, recordLabel, navigate, recordResolved, recordStatusGroup);
  }, [
    pathname,
    navigate,
    projects,
    procurements,
    pipeline,
    lostDeals,
    incidents,
    companies,
    contacts,
    userViewsList,
    projectsPending,
    procurementsPending,
    pipelinePending,
    lostDealsPending,
    incidentsPending,
    companiesPending,
    contactsPending,
    userViewsPending,
  ]);

  // Option A (Task D): stage-aware rail highlight for /projects/:id detail routes.
  // Reuses the same cached lists as the breadcrumb — no new query. The override is
  // null while caches are pending (NavLink URL-based fallback) and resolves on the
  // next render once the pipeline/projects lists settle.
  const railActiveOverride = useMemo<'salesPipeline' | 'projects' | null>(() => {
    const opportunities = [...(pipeline?.projects ?? []), ...(lostDeals ?? [])];
    const statusGroup = recordStatusGroupForPath(pathname, { projects, opportunities });
    return deriveRailActiveOverride(pathname, statusGroup);
  }, [pathname, projects, pipeline, lostDeals]);

  // AC-W3-N3: filter Navigate items by the viewer's REAL role so ⌘K matches the rail.
  // A denied role (e.g. Engineer) never sees Sales/Procurement/Companies/Administration.
  // Read the real role non-throwing; deny-by-default when outside the provider (no Navigate items).
  const realRole = useOptionalRealRole();

  // Palette items: the Records group (cached record index) above the Navigate
  // group (module index routes). The palette filters/caps/ranks both uniformly;
  // Records only show while the user is searching, Navigate always shows.
  // AC-W3-N3: only modules visible to the real role are included (modulesForRole).
  const paletteItems = useMemo<PaletteItem[]>(
    () => [
      ...recordSearch.records,
      ...(realRole ? modulesForRole(realRole as UserRole) : []).map((m) => ({
        id: `nav-${m.module}`,
        group: 'Navigate',
        title: m.label,
        icon: m.icon,
        run: () => navigate(m.path),
      })),
      // "Views" group — appended after "Navigate" when the feature is on (FR-VR-070..071)
      ...(isFeatureEnabled('userViews')
        ? buildViewsPaletteItems(userViewsList, navigate)
        : []),
    ],
    [navigate, recordSearch.records, realRole, userViewsList]
  );

  return (
    <>
      <AppShell
        rail={
          <Rail
            onNavigate={() => setRailOpen(false)}
            railActiveOverride={railActiveOverride}
            // A2: pass openPanel so the Rail "Assistant" button opens the panel (FR-AP-005).
            onOpenAssistant={isFeatureEnabled('agentAssistant') ? openPanel : undefined}
            // A2: thread open state so aria-pressed reflects the actual panel state (WCAG 4.1.2).
            assistantPanelOpen={isFeatureEnabled('agentAssistant') ? assistantOpen : undefined}
          />
        }
        header={
          <ContextBar
            breadcrumb={breadcrumb}
            onOpenPalette={openPalette}
            onToggleRail={() => setRailOpen((v) => !v)}
          />
        }
        banner={<ImpersonationBanner />}
        railOpen={railOpen}
        onCloseRail={() => setRailOpen(false)}
        // A2: mount the panel as a sibling of <main> when flag is on (FR-AP-002, D-A2-6).
        assistant={isFeatureEnabled('agentAssistant') ? <AssistantPanel /> : undefined}
      >
        <AppRoutes />
      </AppShell>
      <CommandPalette
        open={paletteOpen}
        items={paletteItems}
        onClose={() => setPaletteOpen(false)}
        returnFocusTo={paletteTriggerRef.current}
        loading={recordSearch.isPending}
        error={recordSearch.isError}
        onRetry={recordSearch.refetch}
      />
    </>
  );
};

// ── Shell (eager — renders after auth is confirmed) ────────────────────────
const Shell: React.FC = () => {
  const { role } = useAuth();
  return (
    <ImpersonationProvider realRole={role}>
      <ToastProvider>
        {/* A2 (D-A2-5): AgentRuntimeProvider above ShellChrome (above the router)
            so the runtime + open state survive route changes. It is the SOLE
            importer of PmoNativeRuntime (port isolation, AC-AP-024).
            Flag-off: provides runtime=null, open=false — zero overhead. */}
        <AgentRuntimeProvider>
          <ShellChrome />
        </AgentRuntimeProvider>
      </ToastProvider>
    </ImpersonationProvider>
  );
};

// ── Root (eager — auth layer is never lazy-split) ─────────────────────────
const App: React.FC = () => (
  <>
    {/* Non-prod backend ribbon (renders null in prod) — see VITE_APP_ENV in docs/environments.md. */}
    <EnvBadge />
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <AnalyticsProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route element={<RequireAuth />}>
                <Route path="/*" element={<Shell />} />
              </Route>
            </Routes>
          </AnalyticsProvider>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </>
);

export default App;
