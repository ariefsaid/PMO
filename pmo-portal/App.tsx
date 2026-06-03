import React, { Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/src/lib/queryClient';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import { LoadingFallback } from './components/LoadingFallback';
import { AuthProvider } from '@/src/auth/AuthProvider';
import { RequireAuth } from '@/src/auth/RequireAuth';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { useAuth } from '@/src/auth/useAuth';
import LoginPage from '@/src/auth/LoginPage';

// ── Lazy route chunks ──────────────────────────────────────────────────────
// Each page gets its own async chunk so the initial bundle only includes the
// app shell (Sidebar, Header, providers, auth).  Recharts lands in the
// ExecutiveDashboard chunk and is never in the main entry.

const ExecutiveDashboard = React.lazy(() => import('./pages/ExecutiveDashboard'));
const Projects = React.lazy(() => import('./pages/Projects'));
const ProjectDetails = React.lazy(() => import('./pages/ProjectDetails'));
const SalesPipeline = React.lazy(() => import('./pages/SalesPipeline'));
const ProcurementPage = React.lazy(() => import('./pages/Procurement'));
const ProcurementDetails = React.lazy(() => import('./pages/ProcurementDetails'));
const TimesheetsPage = React.lazy(() => import('./pages/Timesheets'));
const PlaceholderPage = React.lazy(() => import('./pages/PlaceholderPage'));

// ── Shell (eager — renders after auth is confirmed) ────────────────────────
// Suspense is INSIDE the authed shell so the loading fallback appears within
// the layout (sidebar + header stay visible while the route chunk loads).

const Shell: React.FC = () => {
  const { role } = useAuth();
  return (
    <ImpersonationProvider realRole={role}>
      <div className="flex h-screen bg-gray-50 dark:bg-gray-900 overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <Header />
          <main className="flex-1 overflow-x-hidden overflow-y-auto bg-gray-100 dark:bg-gray-800 p-4 sm:p-6 lg:p-8">
            <Suspense fallback={<LoadingFallback />}>
              <Routes>
                <Route path="/" element={<ExecutiveDashboard />} />
                <Route path="/projects" element={<Projects />} />
                <Route path="/projects/:projectId" element={<ProjectDetails />} />
                <Route path="/sales" element={<SalesPipeline />} />
                <Route path="/procurement" element={<ProcurementPage />} />
                <Route path="/procurement/:procurementId" element={<ProcurementDetails />} />
                <Route path="/timesheets" element={<TimesheetsPage />} />
                <Route path="/tasks" element={<PlaceholderPage title="Tasks" />} />
                <Route path="/companies" element={<PlaceholderPage title="Companies" />} />
                <Route path="/work-orders" element={<PlaceholderPage title="Work Orders" />} />
                <Route path="/reports" element={<PlaceholderPage title="Reports" />} />
                <Route path="/administration" element={<PlaceholderPage title="Administration" />} />
                <Route path="*" element={<ExecutiveDashboard />} />
              </Routes>
            </Suspense>
          </main>
        </div>
      </div>
    </ImpersonationProvider>
  );
};

// ── Root (eager — auth layer is never lazy-split) ─────────────────────────

const App: React.FC = () => {
  // Basic dark mode toggle logic
  React.useEffect(() => {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.classList.add('dark');
    }
  }, []);

  return (
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
};

export default App;
