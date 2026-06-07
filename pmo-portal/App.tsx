import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/src/lib/queryClient';
import { LoadingFallback } from './components/LoadingFallback';
import { AuthProvider } from '@/src/auth/AuthProvider';
import { RequireAuth } from '@/src/auth/RequireAuth';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { useAuth } from '@/src/auth/useAuth';
import LoginPage from '@/src/auth/LoginPage';
import {
  AppShell,
  Rail,
  ContextBar,
  CommandPalette,
  MODULES,
  breadcrumbForPath,
  recordLabelForPath,
} from '@/src/components/shell';
import type { PaletteItem } from '@/src/components/shell';
import type { BreadcrumbPart } from '@/src/components/shell';
import { useProjects } from '@/src/hooks/useProjects';
import { useProcurements } from '@/src/hooks/useProcurements';
import { useSalesPipeline } from '@/src/hooks/useDashboard';
import { ToastProvider } from '@/src/components/ui';

// ── Lazy route chunks ──────────────────────────────────────────────────────
const ExecutiveDashboard = React.lazy(() => import('./pages/ExecutiveDashboard'));
const Projects = React.lazy(() => import('./pages/Projects'));
const ProjectDetail = React.lazy(() => import('./pages/project-detail/ProjectDetail'));
const SalesPipeline = React.lazy(() => import('./pages/SalesPipeline'));
const OpportunityDetail = React.lazy(() => import('./pages/OpportunityDetail'));
const ProcurementPage = React.lazy(() => import('./pages/Procurement'));
const ProcurementDetails = React.lazy(() => import('./pages/ProcurementDetails'));
const TimesheetsPage = React.lazy(() => import('./pages/Timesheets'));
const ApprovalsPage = React.lazy(() => import('./pages/Approvals'));
const PlaceholderPage = React.lazy(() => import('./pages/PlaceholderPage'));

const AppRoutes: React.FC = () => (
  <Suspense fallback={<LoadingFallback />}>
    <Routes>
      <Route path="/" element={<ExecutiveDashboard />} />
      <Route path="/projects" element={<Projects />} />
      <Route path="/projects/:projectId" element={<ProjectDetail />} />
      <Route path="/projects/:projectId/budget" element={<ProjectDetail />} />
      <Route path="/sales" element={<SalesPipeline />} />
      <Route path="/sales/:opportunityId" element={<OpportunityDetail />} />
      <Route path="/procurement" element={<ProcurementPage />} />
      <Route path="/procurement/:procurementId" element={<ProcurementDetails />} />
      <Route path="/timesheets" element={<TimesheetsPage />} />
      <Route path="/approvals" element={<ApprovalsPage />} />
      <Route path="/tasks" element={<PlaceholderPage title="Tasks" />} />
      <Route path="/companies" element={<PlaceholderPage title="Companies" />} />
      <Route path="/work-orders" element={<PlaceholderPage title="Work Orders" />} />
      <Route path="/reports" element={<PlaceholderPage title="Reports" />} />
      <Route path="/administration" element={<PlaceholderPage title="Administration" />} />
      <Route path="*" element={<ExecutiveDashboard />} />
    </Routes>
  </Suspense>
);

// ── Shell chrome (inside the workspace provider) ───────────────────────────
const ShellChrome: React.FC = () => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const paletteTriggerRef = useRef<HTMLElement | null>(null);

  // Cached index lists — already fetched by the index pages; read here only to
  // resolve a detail route's human record name for the breadcrumb (no new
  // query). The breadcrumb falls back to "Loading…" on a cold deep-link, never
  // a raw UUID.
  const { data: projects } = useProjects();
  const { data: procurements } = useProcurements();
  const { data: pipeline } = useSalesPipeline();

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
    const recordLabel = recordLabelForPath(pathname, {
      projects,
      opportunities: pipeline?.projects,
      procurements,
    });
    return breadcrumbForPath(pathname, recordLabel, navigate);
  }, [pathname, navigate, projects, procurements, pipeline]);

  // Palette items: Navigate to each module. Record search is added in a
  // follow-up surface issue (Phase E); this preserves the existing module-nav
  // Navigate group via a plain route navigate.
  const paletteItems = useMemo<PaletteItem[]>(
    () =>
      MODULES.map((m) => ({
        id: `nav-${m.module}`,
        group: 'Navigate',
        title: m.label,
        icon: m.icon,
        run: () => navigate(m.path),
      })),
    [navigate]
  );

  return (
    <>
      <AppShell
        rail={<Rail onNavigate={() => setRailOpen(false)} />}
        header={
          <ContextBar
            breadcrumb={breadcrumb}
            onOpenPalette={openPalette}
            onToggleRail={() => setRailOpen((v) => !v)}
          />
        }
        railOpen={railOpen}
        onCloseRail={() => setRailOpen(false)}
      >
        <AppRoutes />
      </AppShell>
      <CommandPalette
        open={paletteOpen}
        items={paletteItems}
        onClose={() => setPaletteOpen(false)}
        returnFocusTo={paletteTriggerRef.current}
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
        <ShellChrome />
      </ToastProvider>
    </ImpersonationProvider>
  );
};

// ── Root (eager — auth layer is never lazy-split) ─────────────────────────
const App: React.FC = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<RequireAuth />}>
            <Route path="/*" element={<Shell />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
