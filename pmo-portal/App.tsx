import React, { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  createBrowserRouter,
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
  useRoutes,
  type RouteObject,
  type DataRouter,
} from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { queryClient } from '@/src/lib/queryClient';
import { LoadingFallback } from './components/LoadingFallback';
import { AuthProvider } from '@/src/auth/AuthProvider';
import { I18nProvider } from '@/src/lib/i18n/I18nProvider';
import { RequireAuth } from '@/src/auth/RequireAuth';
import { RequireInviteAccepted } from '@/src/auth/RequireInviteAccepted';
import { AnalyticsProvider } from '@/src/lib/analytics';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ImpersonationBanner } from '@/src/auth/ImpersonationBanner';
import { useAuth } from '@/src/auth/useAuth';
import { useOperatorMembership } from '@/src/auth/useIsOperator';
import LoginPage from '@/src/auth/LoginPage';
import TermsPage from './pages/Terms';
import PrivacyPage from './pages/Privacy';
import ResetPasswordPage from '@/src/auth/ResetPasswordPage';
import UpdatePasswordPage from '@/src/auth/UpdatePasswordPage';
import OAuthConsentPage from '@/src/auth/OAuthConsentPage';
import {
  AppShell,
  Rail,
  ContextBar,
  CommandPalette,
  PhoneNavBar,
  LegacyHomeRedirect,
  modulesForRoleWithOperator,
  agentEntityForPath,
  breadcrumbForPath,
  recordLabelForPath,
  recordContractualNameForPath,
  recordStatusGroupForPath,
  deriveRailActiveOverride,
} from '@/src/components/shell';
import type { PaletteItem } from '@/src/components/shell';
import type { BreadcrumbPart } from '@/src/components/shell';
import { useCachedRecordLists } from '@/src/hooks/useCachedRecordLists';
import { useRecordSearch } from '@/src/hooks/useRecordSearch';
import { useOptionalRealRole } from '@/src/auth/impersonation';
import { useDemoEligibility } from '@/src/hooks/useDemoEligibility';
import { usePermission } from '@/src/auth/usePermission';
import { UserRole } from './types';
import { AccessDenied, ToastProvider, TOOLTIP_OPEN_DELAY_MS } from '@/src/components/ui';
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import { EnvBadge } from '@/src/components/EnvBadge';
import { ErrorBoundary } from '@/src/components/ErrorBoundary';
import { DocumentViewerProvider } from '@/src/components/documents';
import { FeatureRoute } from '@/src/components/FeatureRoute';
import { useFeature } from '@/src/auth/useFeature';
import { FEATURE_ENV_DEFAULT, type EntitleableKey } from '@/src/lib/features';
import { useOrgFeatures } from '@/src/hooks/useOrgFeatures';
import { buildViewsPaletteItems } from '@/src/lib/viewspec/paletteItems';
import { contextualListReturnNavigation } from '@/src/lib/listReturnContext';
import { useReturnNavigate } from '@/src/hooks/useListReturn';
import { lazyWithPreload } from '@/src/lib/lazyWithPreload';
import { i18next } from '@/src/lib/i18n';
import { preloadMinutesEditor } from '@/src/components/meetings/minutesEditorChunk';
import { PROJECT_TAB_CHUNKS, ProjectSCurve } from './pages/project-detail/lazyProjectChunks';
// A2 (ADR-0040): AssistantPanel + provider + hotkey — flag-gated, absent when off.
import { AgentRuntimeProvider } from '@/src/lib/agent/runtime/AgentRuntimeProvider';
import { useAgentRuntimeContext } from '@/src/lib/agent/runtime/AgentRuntimeContext';
import { AssistantPanelSlot } from '@/src/components/panel/AssistantPanelSlot';
import { FeedbackWidget } from '@/src/components/feedback/FeedbackWidget';
import { SurveyHost } from '@/src/components/feedback/SurveyHost';
import { useAssistantHotkey } from '@/src/hooks/useAssistantHotkey';
// ADR-0056: seeds the fail-closed task-write ownership cache load-on-auth (mounted once in Shell).
import { useOwnershipCacheSync } from '@/src/hooks/useOwnershipCacheSync';
// ADR-0045 §3: live context (route/entity/selection) source for agent runs.
import { AgentContextProvider } from '@/src/lib/agent/context/AgentContextProvider';
import { useAgentContext } from '@/src/lib/agent/context/useAgentContext';
import { AccountMenu } from '@/src/components/shell/AccountMenu';

// ── Lazy route chunks (lazyWithPreload: each carries an idempotent preload() —
//    #1834 fires it on nav-link hover/focus/pointerdown and on route entry, so
//    the chunk downloads in parallel with the route's data instead of after it) ─
const ExecutiveDashboard = lazyWithPreload(() => import('./pages/ExecutiveDashboard'));
const Projects = lazyWithPreload(() => import('./pages/Projects'));
const ProjectNew = lazyWithPreload(() => import('./pages/ProjectNew'));
const ProjectDetail = lazyWithPreload(() => import('./pages/project-detail/ProjectDetail'));
const SalesPipeline = lazyWithPreload(() => import('./pages/SalesPipeline'));
const ProcurementPage = lazyWithPreload(() => import('./pages/Procurement'));
const ProcurementDetails = lazyWithPreload(() => import('./pages/ProcurementDetails'));
const ProcurementCreate = lazyWithPreload(() => import('./pages/ProcurementCreate'));
const TimesheetsPage = lazyWithPreload(() => import('./pages/Timesheets'));
const ImprestFloatsPage = lazyWithPreload(() => import('./pages/ImprestFloats'));
const ImprestFloatDetailPage = lazyWithPreload(() => import('./pages/ImprestFloatDetail'));
const EquipmentUsagePage = lazyWithPreload(() => import('./pages/equipment/EquipmentUsage'));
const EquipmentAssetsPage = lazyWithPreload(() => import('./pages/equipment/EquipmentAssets'));
const EquipmentAssetDetailPage = lazyWithPreload(() => import('./pages/equipment/EquipmentAssetDetail'));
const ApprovalsPage = lazyWithPreload(() => import('./pages/Approvals'));
const CompaniesPage = lazyWithPreload(() => import('./pages/Companies'));
const MasterDataPage = lazyWithPreload(() => import('./pages/MasterData'));
const CompanyDetailPage = lazyWithPreload(() => import('./pages/CompanyDetail'));
const ContactsPage = lazyWithPreload(() => import('./pages/Contacts'));
const ContactDetailPage = lazyWithPreload(() => import('./pages/ContactDetail'));
const IncidentsPage = lazyWithPreload(() => import('./pages/Incidents'));
const IncidentDetailPage = lazyWithPreload(() => import('./pages/IncidentDetail'));
const AdministrationPage = lazyWithPreload(() => import('./pages/Administration'));
const IntegrationsPage = lazyWithPreload(() => import('./pages/Integrations'));
const MyTasksPage = lazyWithPreload(() => import('./pages/MyTasks'));
const CalendarPage = lazyWithPreload(() => import('./pages/Calendar'));
const NotFoundPage = lazyWithPreload(() => import('./pages/NotFound'));
const UserViewRenderer = lazyWithPreload(() => import('./pages/UserViewRenderer'));
const MyViewsPage = lazyWithPreload(() => import('./pages/MyViewsPage'));
const ViewBuilderPage = lazyWithPreload(() => import('./pages/ViewBuilderPage'));
const MeetingsPage = lazyWithPreload(() => import('./pages/Meetings'));
const MeetingDetailPage = lazyWithPreload(() => import('./pages/MeetingDetail'));
const MeetingCreatePage = lazyWithPreload(() => import('./pages/MeetingCreate'));
const ExpenseClaimsPage = lazyWithPreload(() => import('./pages/ExpenseClaims'));
const ExpenseClaimNewPage = lazyWithPreload(() => import('./pages/ExpenseClaimNew'));
const ExpenseClaimDetailPage = lazyWithPreload(() => import('./pages/ExpenseClaimDetail'));
const SalesInvoicesPage = lazyWithPreload(() => import('./pages/SalesInvoices'));
const IncomingPaymentsPage = lazyWithPreload(() => import('./pages/IncomingPayments'));
const ErpPurchasesPage = lazyWithPreload(() => import('./pages/ErpPurchases'));
const FinancialStatementsPage = lazyWithPreload(() => import('./pages/FinancialStatements'));
const ManagementPackPage = lazyWithPreload(() => import('./pages/ManagementPack'));
const FinanceHubPage = lazyWithPreload(() => import('./pages/finance/FinanceHub'));
const ReceivablesPage = lazyWithPreload(() => import('./pages/finance/ReceivablesPage'));
const PayablesPage = lazyWithPreload(() => import('./pages/finance/PayablesPage'));
const ProfileSettingsPage = lazyWithPreload(() => import('./pages/ProfileSettings'));
const StockSetupPage = lazyWithPreload(() => import('./pages/stock/StockSetup'));
const StockOnHandPage = lazyWithPreload(() => import('./pages/stock/StockOnHand'));
const StockDocumentsPage = lazyWithPreload(() => import('./pages/stock/StockDocuments'));
const StockDocumentDetailPage = lazyWithPreload(() => import('./pages/stock/StockDocumentDetail'));
const StockLedgerPage = lazyWithPreload(() => import('./pages/stock/StockLedger'));
const StockMovementFormPage = lazyWithPreload(() => import('./pages/stock/StockMovementForm'));
const StockCountPage = lazyWithPreload(() => import('./pages/stock/StockCount'));
const StockReorderPage = lazyWithPreload(() => import('./pages/stock/StockReorder'));

// ── Route-entry + nav-link preloads (#1834) ──────────────────────────────────
/** Anything with the lazyWithPreload preload() handle (structural — the rules
 * below mix route chunks and in-page chunks of different prop types). */
interface PreloadableRouteChunk {
  preload: () => Promise<unknown>;
}

/** The lazy chunks the contract deep-link tab pulls in one go (see lazyProjectChunks). */
const PROJECT_TAB_CHUNKS_BY_PATH: Record<string, PreloadableRouteChunk[]> = Object.fromEntries(
  Object.entries(PROJECT_TAB_CHUNKS).map(([area, chunks]) => [
    `/projects/:projectId/${area}`,
    [ProjectDetail, ProjectSCurve, ...(chunks ?? [])],
  ]),
);

/**
 * What code each destination needs BEFORE its data can render, keyed by the same
 * path patterns as `appRouteConfig` (first match wins — literals before params).
 * Redirect routes list the TARGET's chunks so the code starts downloading at the
 * old URL instead of one render later.
 *
 * `preloadForPath` fires each chunk's idempotent `preload()` from:
 *  - route entry (an effect on the shell's pathname): deep links, Back/Forward,
 *    ⌘K Navigate and every other navigation start the download at route START,
 *    in parallel with the route's data, instead of when the data arrives;
 *  - rail nav links on hover, focus and pointerdown (the `onPreloadHref` prop).
 *
 * Late IN-PAGE chunks ride along: the meeting routes include the MinutesEditor
 * chunk and the project routes include the overview's ProjectSCurve (+ a
 * deep-linked tab's chunks), so a data response never gates a second download.
 */
/**
 * #2097 — the namespaces a destination's FIRST PAINT needs, loaded by `preloadForPath` in parallel
 * with its code chunk. i18next boots with `common` alone, so without this a page's catalogue would
 * start downloading only when its component mounts (after the chunk) and the first frame would show
 * English source strings. Each entry is the PAGE's own catalogue(s), not the transitive import
 * graph: components lower down declare theirs (`useTranslation('<ns>')`) or are covered by
 * `parseMissingKeyHandler`'s on-demand load. Keep it to what the route renders immediately — the
 * point is a smaller boot, and a needless catalogue is the cost this change removed.
 */
const PROJECT_TAB_NAMESPACES: Record<string, readonly string[]> = {
  budget: ['project'],
  procurement: ['project', 'procurement'],
  materials: ['project', 'stock'],
  tasks: ['project'],
  documents: ['project', 'documentViewer'],
  contract: ['project', 'projectTabs', 'stock', 'timeAndMaterials'],
};

interface PreloadRule {
  path: string;
  chunks: PreloadableRouteChunk[];
  namespaces?: readonly string[];
}

const PRELOAD_RULES: PreloadRule[] = [
  { path: '/', chunks: [ExecutiveDashboard], namespaces: ['dashboard', 'home'] },
  { path: '/projects', chunks: [Projects], namespaces: ['projects'] },
  { path: '/projects/new', chunks: [ProjectNew], namespaces: ['projects'] },
  ...Object.entries(PROJECT_TAB_CHUNKS_BY_PATH).map(([path, chunks]) => ({
    path,
    chunks,
    namespaces: PROJECT_TAB_NAMESPACES[path.split('/').pop() ?? ''] ?? ['project'],
  })),
  { path: '/projects/:projectId/:tab', chunks: [ProjectDetail, ProjectSCurve], namespaces: ['project'] },
  { path: '/projects/:projectId', chunks: [ProjectDetail, ProjectSCurve], namespaces: ['project'] },
  { path: '/sales', chunks: [SalesPipeline], namespaces: ['sales'] },
  // /sales/:id redirects to /projects/:projectId — start that download now.
  { path: '/sales/:opportunityId', chunks: [ProjectDetail, ProjectSCurve], namespaces: ['project'] },
  { path: '/procurement', chunks: [ProcurementPage], namespaces: ['procurement', 'procurementList'] },
  { path: '/procurement/new', chunks: [ProcurementCreate], namespaces: ['procurementCreate'] },
  { path: '/procurement/:procurementId/:tab', chunks: [ProcurementDetails], namespaces: ['procurement', 'procurementCreate', 'procurementRecord'] },
  { path: '/procurement/:procurementId', chunks: [ProcurementDetails], namespaces: ['procurement', 'procurementCreate', 'procurementRecord'] },
  { path: '/timesheets', chunks: [TimesheetsPage], namespaces: ['timesheets'] },
  // The triage queue renders one section per approval domain; all four are static imports.
  { path: '/approvals', chunks: [ApprovalsPage], namespaces: ['procurement', 'imprest', 'timesheets', 'finance'] },
  { path: '/companies', chunks: [CompaniesPage], namespaces: ['crm'] },
  { path: '/master-data/:kind', chunks: [MasterDataPage], namespaces: ['administration'] },
  { path: '/companies/:companyId', chunks: [CompanyDetailPage], namespaces: ['crm'] },
  { path: '/contacts', chunks: [ContactsPage], namespaces: ['crm'] },
  { path: '/contacts/:contactId', chunks: [ContactDetailPage], namespaces: ['crm'] },
  { path: '/incidents', chunks: [IncidentsPage] },
  { path: '/incidents/:incidentId', chunks: [IncidentDetailPage] },
  { path: '/my-tasks', chunks: [MyTasksPage], namespaces: ['tasks'] },
  { path: '/calendar', chunks: [CalendarPage], namespaces: ['calendar'] },
  { path: '/meetings', chunks: [MeetingsPage], namespaces: ['meetings'] },
  { path: '/meetings/new', chunks: [MeetingCreatePage, { preload: preloadMinutesEditor }], namespaces: ['meetingCreate', 'meetings'] },
  { path: '/meetings/:meetingId', chunks: [MeetingDetailPage, { preload: preloadMinutesEditor }], namespaces: ['meetings'] },
  { path: '/expenses', chunks: [ExpenseClaimsPage], namespaces: ['expenseClaims'] },
  { path: '/expenses/new', chunks: [ExpenseClaimNewPage], namespaces: ['expenseClaims', 'imprest'] },
  { path: '/expenses/:claimId', chunks: [ExpenseClaimDetailPage], namespaces: ['imprest'] },
  { path: '/imprest', chunks: [ImprestFloatsPage], namespaces: ['imprest'] },
  { path: '/imprest/:floatId', chunks: [ImprestFloatDetailPage], namespaces: ['imprest'] },
  { path: '/equipment', chunks: [EquipmentUsagePage], namespaces: ['equipment'] },
  { path: '/equipment/assets', chunks: [EquipmentAssetsPage], namespaces: ['equipment'] },
  { path: '/equipment/assets/:assetId', chunks: [EquipmentAssetDetailPage], namespaces: ['equipment'] },
  { path: '/reports', chunks: [ManagementPackPage], namespaces: ['finance', 'financeHub'] },
  { path: '/administration/:section', chunks: [AdministrationPage], namespaces: ['administration', 'costAttribution', 'plans', 'procurement'] },
  { path: '/administration', chunks: [AdministrationPage], namespaces: ['administration', 'costAttribution', 'plans', 'procurement'] },
  { path: '/finance', chunks: [FinanceHubPage], namespaces: ['finance', 'financeHub'] },
  { path: '/finance/receivables', chunks: [ReceivablesPage], namespaces: ['finance', 'financeHub'] },
  { path: '/finance/payables', chunks: [PayablesPage], namespaces: ['finance', 'financeHub'] },
  { path: '/finance/reports', chunks: [ManagementPackPage], namespaces: ['finance', 'financeHub'] },
  { path: '/finance/statements', chunks: [FinancialStatementsPage], namespaces: ['finance'] },
  { path: '/sales-invoices/:invoiceId', chunks: [SalesInvoicesPage], namespaces: ['finance'] },
  { path: '/sales-invoices', chunks: [ReceivablesPage], namespaces: ['finance', 'financeHub'] },
  { path: '/incoming-payments/:receiptId', chunks: [IncomingPaymentsPage], namespaces: ['finance'] },
  { path: '/incoming-payments', chunks: [PayablesPage], namespaces: ['finance', 'financeHub'] },
  { path: '/revenue-by-project', chunks: [ManagementPackPage], namespaces: ['finance', 'financeHub'] },
  { path: '/erp-purchases', chunks: [ErpPurchasesPage], namespaces: ['finance'] },
  { path: '/financial-statements', chunks: [FinancialStatementsPage], namespaces: ['finance'] },
  { path: '/integrations', chunks: [IntegrationsPage], namespaces: ['administration'] },
  // A view is user-composed from arbitrary panels: there is no fixed catalogue set to preload, and
  // each panel's own hook/deep key fetches its catalogue on mount.
  { path: '/views', chunks: [MyViewsPage] },
  { path: '/views/new', chunks: [ViewBuilderPage], namespaces: ['viewBuilder'] },
  { path: '/views/:viewId/edit', chunks: [ViewBuilderPage], namespaces: ['viewBuilder'] },
  { path: '/views/:viewId', chunks: [UserViewRenderer] },
  { path: '/settings/profile', chunks: [ProfileSettingsPage], namespaces: ['profilePreferences'] },
  { path: '/stock/setup', chunks: [StockSetupPage], namespaces: ['stock'] },
  { path: '/stock/documents/:documentId/edit', chunks: [StockCountPage], namespaces: ['stock'] },
  { path: '/stock/documents/:documentId', chunks: [StockDocumentDetailPage], namespaces: ['stock'] },
  { path: '/stock/documents', chunks: [StockDocumentsPage], namespaces: ['stock'] },
  { path: '/stock/ledger', chunks: [StockLedgerPage], namespaces: ['stock'] },
  { path: '/stock/reorder', chunks: [StockReorderPage], namespaces: ['stock'] },
  { path: '/stock/new/:kind', chunks: [StockMovementFormPage], namespaces: ['stock'] },
  { path: '/stock', chunks: [StockOnHandPage], namespaces: ['stock'] },
  { path: '*', chunks: [NotFoundPage] },
];

/** Same semantics the router applies: `:param` matches one segment, `*` matches
 * the rest, literals compare exactly; the pattern must consume the whole path. */
function routePatternMatches(pattern: string, pathname: string): boolean {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = pathname.split('/').filter(Boolean);
  let index = 0;
  for (; index < patternParts.length; index++) {
    if (patternParts[index] === '*') return true;
    const segment = pathParts[index];
    if (segment === undefined) return false;
    if (patternParts[index].startsWith(':')) continue;
    if (patternParts[index] !== segment) return false;
  }
  return index === pathParts.length;
}

/** The chunks `preloadForPath` will fire for this pathname (unit-test seam). */
// eslint-disable-next-line react-refresh/only-export-components -- preload rules are shared with the rail (onPreloadHref) and route-entry tests
export function preloadsForPath(pathname: string): PreloadableRouteChunk[] {
  return preloadRuleForPath(pathname)?.chunks ?? [];
}

function normalizePath(pathname: string): string {
  return pathname.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
}

function preloadRuleForPath(pathname: string): PreloadRule | undefined {
  return PRELOAD_RULES.find((rule) => routePatternMatches(rule.path, normalizePath(pathname)));
}

/**
 * The translation namespaces this destination's first paint renders (#2097). i18next boots with
 * `common` only, so these are what keep a route from painting English source strings while its
 * catalogue is still in flight.
 */
// eslint-disable-next-line react-refresh/only-export-components -- same preload rules, consumed by the route-entry effect and tests
export function namespacesForPath(pathname: string): readonly string[] {
  return preloadRuleForPath(pathname)?.namespaces ?? [];
}

/** Fire every matching route's preloads — its code chunks AND its translation namespaces —
 * in parallel (idempotent per module; i18next de-dupes a namespace it already has). */
// eslint-disable-next-line react-refresh/only-export-components -- same preload rules, consumed by the rail prop and the route-entry effect
export function preloadForPath(pathname: string): void {
  const namespaces = namespacesForPath(pathname);
  if (namespaces.length) void i18next.loadNamespaces(namespaces);
  for (const chunk of preloadsForPath(pathname)) void chunk.preload();
}

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

/** Compatibility entry for the former all-in-one Administration page. */
const AdministrationEntryRedirect: React.FC = () => {
  const { hash } = useLocation();
  const { role } = useAuth();
  const target = hash === '#budget-account-map'
    ? '/administration/accounting#budget-account-map'
    : hash === '#org-project-number-pattern'
      ? '/administration/projects#org-project-number-pattern'
      : role === 'Finance'
        ? '/administration/exchange-rates'
        : '/administration/users';
  return <Navigate to={target} replace />;
};

export const FinanceAccessRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const may = usePermission();
  if (!may('view', 'finance')) {
    return <AccessDenied title={t('financeHub:hub.noAccessTitle', 'Finance')} sub={t('financeHub:hub.noAccessDescription', 'Finance is available to Finance, Executive and Admin roles.')} onBack={() => navigate('/')} />;
  }
  return <>{children}</>;
};

export const FinanceLegacyRedirect: React.FC<{ to: string; paymentsView?: boolean }> = ({ to, paymentsView = false }) => {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  if (paymentsView) params.set('view', 'payments');
  const search = params.toString();
  return <Navigate to={{ pathname: to, search: search ? `?${search}` : '', hash: location.hash }} replace />;
};

/**
 * The application's route table as DATA (NFR-M365SEP-008). `AppRoutes` renders this config via
 * `useRoutes`, so the array is the single source of truth shared by the running app AND by tests
 * that must prove a redirect target resolves to a real route — never the `*` catch-all. Asserting
 * against THIS array (not a hand-written list of paths, not a router a test invented) is what
 * catches a redirect to a route the application does not serve: the token-custody callback used to
 * redirect to `/admin/integrations`, which does not exist, so every completed connect landed on
 * Not Found (m365-operator-client-separation spec §1.3).
 */
/**
 * Gate one route on a resolved switch (AC-PLN-008). A one-line wrapper so every gated route reads
 * the same way and nobody hand-rolls a second resolution path; `<FeatureRoute>` owns the states.
 */
const gated = (feature: EntitleableKey, element: React.ReactNode): React.ReactNode => (
  <FeatureRoute feature={feature} element={element} />
);

// eslint-disable-next-line react-refresh/only-export-components -- route data is shared with route-table tests
export const appRouteConfig: RouteObject[] = [
  { path: '/', element: <ExecutiveDashboard /> },
  { path: '/home', element: <LegacyHomeRedirect /> },
  { path: '/projects', element: <Projects /> },
  // B-9 (AC-W2-IA-004): /projects/:id/:tab? — all five tabs are deep-linkable symmetrically
  //   (budget is just another :tab value). Both routes render ProjectDetail; the component reads
  //   :tab and defaults to 'overview'. A backward-compat alias keeps old /budget links working.
  // One-step create (#806): a static segment, so it outranks `:projectId` below.
  { path: '/projects/new', element: <ProjectNew /> },
  { path: '/projects/:projectId/:tab', element: <ProjectDetail /> },
  { path: '/projects/:projectId', element: <ProjectDetail /> },
  { path: '/sales', element: gated('sales_pipeline', <SalesPipeline />) },
  // Model B: the canonical detail route is /projects/:id; /sales/:id redirects there.
  { path: '/sales/:opportunityId', element: gated('sales_pipeline', <SalesDetailRedirect />) },
  {
    path: '/procurement',
    element: gated('procurement', (
      <Suspense fallback={<LoadingFallback />}>
        <ProcurementPage />
      </Suspense>
    )),
  },
  { path: '/procurement/new', element: gated('procurement', <ProcurementCreate />) },
  // Tabbed record shell (mirrors /projects/:id/:tab). The bare /procurement/:id keeps working
  //   (defaults to the Overview tab); :tab deep-links a panel.
  { path: '/procurement/:procurementId', element: gated('procurement', <ProcurementDetails />) },
  { path: '/procurement/:procurementId/:tab', element: gated('procurement', <ProcurementDetails />) },
  { path: '/timesheets', element: gated('timesheets', <TimesheetsPage />) },
  { path: '/approvals', element: <ApprovalsPage /> },
  { path: '/companies', element: gated('crm', <CompaniesPage />) },
  // #1504 S5 (FR-ODC-111): the Odoo directories, read from PMO's mirror. Reached from the Odoo card.
  { path: '/master-data/:kind', element: <MasterDataPage /> },
  // CW-4b: /companies/:id — the routable Company record page (retires the drawer-as-record).
  { path: '/companies/:companyId', element: gated('crm', <CompanyDetailPage />) },
  { path: '/contacts', element: gated('crm', <ContactsPage />) },
  // CW-4b: /contacts/:id — the routable Contact record page (retires the drawer-as-record).
  { path: '/contacts/:contactId', element: gated('crm', <ContactDetailPage />) },
  // Incidents is hidden behind the interim `incidents` UI feature flag (UI-hide-first):
  //   FeatureRoute renders the page when enabled, else redirects deep-links to home instead of
  //   404. CW-4a: /incidents/:id is the routable detail page when the module is on.
  { path: '/incidents', element: <FeatureRoute feature="incidents" element={<IncidentsPage />} /> },
  { path: '/incidents/:incidentId', element: <FeatureRoute feature="incidents" element={<IncidentDetailPage />} /> },
  // B-1 (AC-W2-IXD-001/002): My Tasks — IC-scoped own-assigned cross-project task list.
  { path: '/my-tasks', element: <MyTasksPage /> },
  // #1982: Calendar — tasks by due date + milestones by target date across projects (RLS-scoped reads, every role).
  { path: '/calendar', element: <CalendarPage /> },
  // #526: Meetings — minuted meetings with attendees, action items and view-only shares.
  //   Reads are RLS-scoped (attendance ∪ author ∪ grant ∪ Admin, migration 0205), so the routes
  //   exist for every role; the detail renders a calm not-found for an unshared meeting.
  { path: '/meetings', element: <MeetingsPage /> },
  { path: '/meetings/new', element: <MeetingCreatePage /> },
  { path: '/meetings/:meetingId', element: <MeetingDetailPage /> },
  // #775: expense claims and cash advances.
  { path: '/expenses', element: <ExpenseClaimsPage /> },
  { path: '/expenses/new', element: <ExpenseClaimNewPage /> },
  { path: '/expenses/:claimId', element: <ExpenseClaimDetailPage /> },
  { path: '/imprest', element: gated('imprest', <ImprestFloatsPage />) },
  { path: '/imprest/:floatId', element: gated('imprest', <ImprestFloatDetailPage />) },
  // #1519: equipment usage grid, asset reference and per-asset costing.
  { path: '/equipment', element: <EquipmentUsagePage /> },
  { path: '/equipment/assets', element: <EquipmentAssetsPage /> },
  { path: '/equipment/assets/:assetId', element: <EquipmentAssetDetailPage /> },
  { path: '/reports', element: <FinanceLegacyRedirect to="/finance/reports" /> },
  { path: '/administration', element: <AdministrationEntryRedirect /> },
  { path: '/administration/users', element: <AdministrationPage /> },
  { path: '/administration/integrations', element: <AdministrationPage /> },
  { path: '/administration/accounting', element: <AdministrationPage /> },
  { path: '/administration/projects', element: <AdministrationPage /> },
  { path: '/administration/credits', element: <AdministrationPage /> },
  { path: '/administration/exchange-rates', element: gated('multi_currency', <AdministrationPage />) },
  { path: '/administration/cost-attribution', element: <AdministrationPage /> },
  { path: '/administration/usage', element: <AdministrationPage /> },
  { path: '/administration/features', element: <AdministrationPage /> },
  // Keep malformed/deprecated Administration section links inside the Administration shell so
  // they can be replaced with Users instead of falling through to the global 404 route.
  { path: '/administration/:section', element: <AdministrationPage /> },
  // Finance section. Each area has one canonical URL; Statements keeps its existing page.
  { path: '/finance', element: <FinanceAccessRoute><FinanceHubPage /></FinanceAccessRoute> },
  { path: '/finance/receivables', element: <FinanceAccessRoute><FeatureRoute feature="revenue" element={<ReceivablesPage />} /></FinanceAccessRoute> },
  { path: '/finance/payables', element: <FinanceAccessRoute><FeatureRoute feature="procurement" element={<PayablesPage />} /></FinanceAccessRoute> },
  { path: '/finance/reports', element: <FinanceAccessRoute><FeatureRoute feature="management_pack" element={<ManagementPackPage />} /></FinanceAccessRoute> },
  { path: '/finance/statements', element: <FinanceAccessRoute>{gated('financial_statements', <FinancialStatementsPage />)}</FinanceAccessRoute> },
  { path: '/sales-invoices', element: <FinanceLegacyRedirect to="/finance/receivables" /> },
  { path: '/sales-invoices/:invoiceId', element: gated('sales_invoices', <SalesInvoicesPage />) },
  { path: '/incoming-payments', element: <FinanceLegacyRedirect to="/finance/receivables" paymentsView /> },
  { path: '/incoming-payments/:receiptId', element: <IncomingPaymentsPage /> },
  { path: '/revenue-by-project', element: <FinanceLegacyRedirect to="/finance/reports" /> },
  { path: '/erp-purchases', element: gated('erp_purchases', <ErpPurchasesPage />) },
  { path: '/financial-statements', element: <FinanceLegacyRedirect to="/finance/statements" /> },
  // M365 connection-model (D2): the personal-connect surface any active member of an entitled
  //   org can reach. This is the route the token-custody callback redirects to (Phase A) —
  //   AC-M365SEP-018 asserts it resolves here so the callback never falls through to the catch-all.
  { path: '/integrations', element: <IntegrationsPage /> },
  // I4: My Views list (/views) — before /:viewId to avoid wildcard collision.
  { path: '/views', element: <FeatureRoute feature="user_views" element={<MyViewsPage />} /> },
  // I4: Create builder — literal 'new' before /:viewId param.
  { path: '/views/new', element: <FeatureRoute feature="user_views" element={<ViewBuilderPage mode="create" />} /> },
  // I4: Edit builder — /:viewId/edit is more specific than /:viewId alone.
  { path: '/views/:viewId/edit', element: <FeatureRoute feature="user_views" element={<ViewBuilderPage mode="edit" />} /> },
  // I3: User-view renderer: /views/:viewId. Declared after /views/new and /views/:viewId/edit to
  //   avoid wildcard collision.
  { path: '/views/:viewId', element: <FeatureRoute feature="user_views" element={<UserViewRenderer />} /> },
  // Personal profile language settings (RIS slice): every signed-in user's interface-language
  //   override. Declared before the `*` catch-all so it resolves to a real route.
  { path: '/settings/profile', element: <ProfileSettingsPage /> },
  // Stock (#1512). Every segment is static or under /documents, so none can shadow another.
  { path: '/stock', element: gated('stock', <StockOnHandPage />) },
  { path: '/stock/setup', element: gated('stock', <StockSetupPage />) },
  { path: '/stock/documents', element: gated('stock', <StockDocumentsPage />) },
  { path: '/stock/documents/:documentId', element: gated('stock', <StockDocumentDetailPage />) },
  { path: '/stock/documents/:documentId/edit', element: gated('stock', <StockCountPage />) },
  { path: '/stock/ledger', element: gated('stock', <StockLedgerPage />) },
  { path: '/stock/reorder', element: gated('stock', <StockReorderPage />) },
  { path: '/stock/new/:kind', element: gated('stock', <StockMovementFormPage />) },
  { path: '*', element: <NotFoundPage /> },
];

// memo: ShellChrome re-renders on every record-cache settle; the routes only depend on the location.
export const AppRoutes: React.FC = React.memo(function AppRoutes() {
  return <Suspense fallback={<LoadingFallback />}>{useRoutes(appRouteConfig)}</Suspense>;
});

// ── Shell chrome (inside the workspace provider + AgentRuntimeProvider) ───────
export const ShellChrome: React.FC = () => {
  const location = useLocation();
  const { pathname } = location;
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const paletteTriggerRef = useRef<HTMLElement | null>(null);

  // #1834: route entry fires the route's — and its late in-page chunks' —
  // preload() immediately, so deep links, Back/Forward and ⌘K Navigate start
  // downloading code in parallel with data instead of after it. Idempotent per
  // module (lazyWithPreload memoizes the import promise).
  useEffect(() => {
    preloadForPath(pathname);
  }, [pathname]);

  // A2: Read panel open-state controls from AgentRuntimeProvider context.
  // These are stable callbacks (never change identity), safe to use here.
  const { togglePanel, openPanel, open: assistantOpen } = useAgentRuntimeContext();
  // The two deployment-gated keys: entitlement AND the env kill switch, in ONE place (useFeature).
  // An operator cannot grant what the deployment turned off, and the env flag still hides the
  // surface for every org (S3 constraint; `aiComposer` stays an env-only sub-flag).
  const assistantEntitled = useFeature('agent_assistant');
  const userViewsEntitled = useFeature('user_views');

  // A2: Register ⌘J / Ctrl+J global hotkey — flag-gated (FR-AP-004).
  useAssistantHotkey({
    enabled: assistantEntitled,
    onToggle: togglePanel,
  });

  // Cache-only record lists (#840) — read from whatever the index / detail pages already loaded;
  // the shell NEVER triggers a list fetch just to name a crumb. A cold deep link shows "Loading…"
  // until the page's own by-id query resolves, then the record name; "Not found" once that settles
  // without the record (item I), never a perpetual "Loading…". A Loss-Tender deal (Blocker 1,
  // AC-IXD-PROJ-005, ADR-0020 §4) lives in neither the active-projects nor open-pipeline cache, so
  // it resolves from the project detail record or the lost-deals cache (unioned into
  // `opportunities`). The incidents list is read although the `incidents` flag hides the module
  // (CW-4a): the routes redirect, so it stays dormant — a one-line flag flip, do NOT "tidy" it away.
  const { lists: cachedLists, resolved: recordResolved } = useCachedRecordLists(pathname);
  const { projects, opportunities, procurements, companies, contacts } = cachedLists;
  const userViewsList = cachedLists.userViews;
  const contextualParent = useMemo(() => {
    return contextualListReturnNavigation(pathname, location.state);
  }, [location.state, pathname]);

  // Desktop breadcrumb navigation pushes the same clean return entry the mobile BackBar uses:
  // the validated list path plus its one-shot scroll-restore state (no pmoListReturn on the list).
  const breadcrumbNavigate = useReturnNavigate();

  // The shell already has enough cached record data to render the detail breadcrumb before a lazy
  // page chunk mounts. Publish that same identity before paint so an immediate Assistant turn made
  // from the loading shell is grounded; detail pages republish the identical value once mounted.
  const { setEntity } = useAgentContext();
  const routeEntity = useMemo(
    () =>
      agentEntityForPath(pathname, {
        projects,
        opportunities,
        procurements,
        companies,
        contacts,
      }),
    [pathname, projects, opportunities, procurements, companies, contacts],
  );
  useLayoutEffect(() => {
    setEntity(routeEntity);
    return () => setEntity(undefined);
  }, [routeEntity, setEntity]);

  // ⌘K record search: indexes the record lists into Records rows that open the matching detail
  // route. The lists load only while the palette is open (#840) — never on a cold page load.
  // (AC-CMDK-001/003/004/005)
  const recordSearch = useRecordSearch(navigate, { enabled: paletteOpen });

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
  // Stable callbacks/elements so the memoised Rail and ContextBar skip shell re-renders.
  const closeRail = useCallback(() => setRailOpen(false), []);
  const toggleRail = useCallback(() => setRailOpen((v) => !v), []);
  const feedbackWidget = useMemo(() => <FeedbackWidget />, []);
  const assistantPanel = useMemo(() => <AssistantPanelSlot open={assistantOpen} />, [assistantOpen]);

  // Breadcrumb derives from the ROUTE (URL is the source of truth) — no tab
  // state. A detail route resolves its record name from the cached index lists;
  // a placeholder route reads its own page title; the module segment navigates
  // to its index. (AC-NAV-003/004/005)
  const breadcrumb = useMemo<BreadcrumbPart[]>(() => {
    if (pathname === '/settings/profile') {
      return [{ label: t('shell.nav.profileSettings', 'Profile & preferences') }];
    }
    const recordListPath = (location.state as { recordContext?: { listPath?: string } } | null)?.recordContext?.listPath;
    const invoiceRecordLabel = (location.state as { recordContext?: { recordLabel?: string } } | null)?.recordContext?.recordLabel;
    const canonicalReceivablesList = (fallbackPayments = false) => {
      const legacyPath = /^\/(sales-invoices|incoming-payments)(?:$|\?)/.test(recordListPath ?? '')
        ? recordListPath!
        : '';
      const source = legacyPath || recordListPath || `/finance/receivables${location.search}`;
      const parsed = new URL(source, window.location.origin);
      if (parsed.pathname === '/sales-invoices' || parsed.pathname === '/incoming-payments') parsed.pathname = '/finance/receivables';
      parsed.searchParams.delete('layout');
      if (fallbackPayments) parsed.searchParams.set('view', 'payments');
      return `${parsed.pathname}${parsed.search}`;
    };
    if (/^\/sales-invoices\/[^/]+$/.test(pathname)) {
      const listPath = canonicalReceivablesList();
      return [
        {
          label: t('financeHub:nav.finance', 'Finance'),
          href: '/finance',
          onClick: () => breadcrumbNavigate('/finance'),
        },
        {
          label: t('financeHub:hub.receivables', 'Receivables'),
          href: listPath,
          onClick: () => breadcrumbNavigate(listPath),
        },
        { label: invoiceRecordLabel ?? t('shell.nav.invoiceRecord', 'Invoice record') },
      ];
    }
    if (/^\/incoming-payments\/[^/]+$/.test(pathname)) {
      const listPath = canonicalReceivablesList(true);
      return [
        {
          label: t('financeHub:nav.overview', 'Overview'),
          href: '/finance',
          onClick: () => breadcrumbNavigate('/finance'),
        },
        {
          label: t('financeHub:hub.receivables', 'Receivables'),
          href: listPath,
          onClick: () => breadcrumbNavigate(listPath),
        },
        { label: t('financeHub:nav.incomingPayment', 'Incoming payment') },
      ];
    }
    const fromPayables = (location.state as { recordContext?: { origin?: string } } | null)?.recordContext?.origin === 'finance-payables';
    if (fromPayables && /^\/procurement\/[^/]+$/.test(pathname)) {
      const recordLabel = recordLabelForPath(pathname, cachedLists);
      return [
        {
          label: t('financeHub:hub.payablesTitle', 'Payables'),
          href: '/finance/payables',
          onClick: () => breadcrumbNavigate('/finance/payables'),
        },
        {
          label: t('shell.nav.procurement', 'Procurement'),
          href: '/procurement',
          onClick: () => breadcrumbNavigate('/procurement'),
        },
        {
          label: recordLabel ?? t(recordResolved ? 'shell.breadcrumb.recordNotFound' : 'shell.breadcrumb.recordLoading', recordResolved ? 'Not found' : 'Loading…'),
        },
      ];
    }
    // The pipeline partition the resolvers read = open pipeline ∪ lost deals (Blocker 1). A lost
    // deal is absent from both the open-pipeline cache and the active-projects cache, so it must be
    // unioned in here or its crumb resolves to "Projects > Not found".
    const recordLabel = recordLabelForPath(pathname, cachedLists);
    const parts = breadcrumbForPath(
      pathname,
      recordLabel,
      breadcrumbNavigate,
      recordResolved,
      contextualParent,
      // A filtered doorway (e.g. Vendors = Companies?type=Vendor) owns its visible
      // vocabulary in the route-derived parts; the Breadcrumb component keeps a
      // render-level fallback for direct mounts without the router location.
      location.search,
    );
    const contractualName = recordContractualNameForPath(pathname, cachedLists);
    if (!contractualName || parts.length === 0) return parts;
    const current = parts.length - 1;
    return parts.map((part, index) => index === current ? { ...part, title: contractualName } : part);
  }, [
    pathname,
    location.search,
    location.state,
    contextualParent,
    t,
    breadcrumbNavigate,
    cachedLists,
    recordResolved,
  ]);

  // Option A (Task D): stage-aware rail highlight for /projects/:id detail routes.
  // Reuses the same cached lists as the breadcrumb — no new query. The override is
  // null while caches are pending (NavLink URL-based fallback) and resolves on the
  // next render once the pipeline/projects lists settle.
  const railActiveOverride = useMemo<'salesPipeline' | 'projects' | null>(() => {
    const statusGroup = recordStatusGroupForPath(pathname, { projects, opportunities });
    return deriveRailActiveOverride(pathname, statusGroup);
  }, [pathname, projects, opportunities]);

  // AC-W3-N3: filter Navigate items by the viewer's REAL role, plus verified Operator membership.
  // A plain Engineer does not see Sales/Procurement/Companies/Administration; a verified Operator
  // gains Administration. Outside the provider there are no Navigate items.
  const realRole = useOptionalRealRole();
  // AC-ADMIA-002: a REAL server-confirmed platform Operator gains Administration in ⌘K regardless
  // of base role. Sourced from the settled `useIsOperator()` projection — never effective/preview
  // role — so a plain Engineer stays hidden. Fail-closed (false) while loading.
  const operatorMembership = useOperatorMembership();
  const isOperator = operatorMembership.isOperator;
  const { data: orgFeatures } = useOrgFeatures();
  const needsOperatorRecovery = Boolean(realRole) && operatorMembership.isError &&
    realRole !== UserRole.Admin && realRole !== UserRole.Executive;

  // Palette items: the Records group (cached record index) above the Navigate
  // group (module index routes). The palette filters/caps/ranks both uniformly;
  // Records only show while the user is searching, Navigate always shows.
  // AC-W3-N3: only modules visible to the real role are included (modulesForRole).
  const paletteItems = useMemo<PaletteItem[]>(
    () => [
      ...recordSearch.records,
      ...(realRole ? modulesForRoleWithOperator(realRole as UserRole, isOperator) : [])
        .filter((module) => !module.feature || (orgFeatures?.[module.feature] ?? FEATURE_ENV_DEFAULT[module.feature]) === true)
        .filter((module) => !module.unlessFeature || (orgFeatures?.[module.unlessFeature] ?? FEATURE_ENV_DEFAULT[module.unlessFeature]) !== true)
        .filter((module) => module.module !== 'views' || userViewsEntitled)
        .map((m) => ({
        id: `nav-${m.module}`,
        group: 'Navigate',
        title: m.module === 'administration'
          ? t('shell.nav.administration', 'Administration')
          : m.labelKey ? t(m.labelKey, m.label) : m.label,
        sub: m.module === 'my-tasks'
          ? t('shell.nav.myTasksHint', 'Your assigned work across projects')
          : undefined,
        icon: m.icon,
        run: () => navigate(m.path),
      })),
      ...(needsOperatorRecovery ? [{
        id: 'nav-administration-check',
        group: 'Navigate' as const,
        title: t('admin.access.checkEntry', 'Check Administration access'),
        icon: 'admin' as const,
        run: () => navigate('/administration/users'),
      }] : []),
      // "Views" group — appended after "Navigate" when the feature is on (FR-VR-070..071)
      ...(userViewsEntitled
        ? buildViewsPaletteItems(userViewsList, navigate)
        : []),
    ],
    [navigate, recordSearch.records, realRole, isOperator, needsOperatorRecovery, orgFeatures, t, userViewsList, userViewsEntitled]
  );

  return (
    <>
      <AppShell
        phoneNav={
          <PhoneNavBar
            onOpenMore={toggleRail}
            onOpenSearch={openPalette}
            moreOpen={railOpen}
          />
        }
        drawerActions={<AccountMenu />}
        rail={
          <Rail
            onNavigate={closeRail}
            onPreloadHref={preloadForPath}
            railActiveOverride={railActiveOverride}
            operatorAccessError={needsOperatorRecovery}
            // A2: pass openPanel so the Rail "Assistant" button opens the panel (FR-AP-005).
            onOpenAssistant={assistantEntitled ? openPanel : undefined}
            // A2: thread open state so aria-pressed reflects the actual panel state (WCAG 4.1.2).
            assistantPanelOpen={assistantEntitled ? assistantOpen : undefined}
          />
        }
        header={
          <ContextBar
            breadcrumb={breadcrumb}
            onOpenPalette={openPalette}
            onOpenMore={toggleRail}
            moreOpen={railOpen}
            beforeBell={feedbackWidget}
          />
        }
        banner={<ImpersonationBanner />}
        railOpen={railOpen}
        onCloseRail={closeRail}
        assistantOpen={assistantEntitled ? assistantOpen : false}
        // A2: mount the panel as a sibling of <main> when flag is on (FR-AP-002, D-A2-6).
        assistant={assistantEntitled ? assistantPanel : undefined}
      >
        <AppRoutes />
      </AppShell>
      <SurveyHost />
      <CommandPalette
        open={paletteOpen}
        items={paletteItems}
        onClose={() => setPaletteOpen(false)}
        returnFocusTo={paletteTriggerRef.current}
        loading={recordSearch.isPending}
        error={recordSearch.isError}
        onRetry={recordSearch.refetch}
        onAskAi={
          assistantEntitled
            ? (query) => {
                setPaletteOpen(false);
                openPanel(query);
              }
            : undefined
        }
      />
    </>
  );
};

// ── Shell (eager — renders after auth is confirmed) ────────────────────────
const Shell: React.FC = () => {
  const { role } = useAuth();
  // ADR-0056: mount exactly once in the authenticated shell — seeds/clears the module-level
  // ownership cache so routeTaskWrite() routes task writes correctly (fail-closed 'pmo').
  useOwnershipCacheSync();
  // FR-AUTH-036 (AC-AUTH-013/014): the Admin "view as role" control exists ONLY for Admins
  // of a demo org. The hook reads the signed-in org's lifecycle_state via RLS (never a
  // hardcoded org id) and FAILS CLOSED to 'pending' while loading or on error.
  const demoEligibility = useDemoEligibility();
  return (
    <ImpersonationProvider realRole={role} demoEligibility={demoEligibility}>
      <ToastProvider>
        {/* #2123: one tooltip delay group for the whole shell. 400ms of hover intent stops a
            pointer sweeping a table from flashing a panel per cell; Base UI then opens a
            neighbour instantly (data-instant) once one tooltip has opened. */}
        <BaseTooltip.Provider delay={TOOLTIP_OPEN_DELAY_MS} closeDelay={0}>
          {/* A2 (D-A2-5): AgentRuntimeProvider above ShellChrome (above the router)
              so the runtime + open state survive route changes. It is the SOLE
              importer of PmoNativeRuntime (port isolation, AC-AP-024).
              Flag-off: provides runtime=null, open=false — zero overhead.
              ADR-0045 §3: AgentContextProvider nests inside — it reads the router
              location (useLocation, available here since Shell renders inside
              the data router) and is the source useAssistantPanel reads via
              useAgentContext() when threading context on createRun/followUp. */}
          <AgentRuntimeProvider>
            <AgentContextProvider>
              {/* Reliability harden #4: a render throw anywhere in the authenticated
                  shell/routes renders the ErrorBoundary fallback (retry / reload / home)
                  instead of white-screening the SPA. Wrapped inside the providers so a
                  recovery keeps auth/runtime/toast context intact. */}
              <ErrorBoundary>
                {/* #1474: one side-panel document viewer for every document entry point; it sits inside the
                    router (route change closes it) and above the routes so the panel survives list re-renders. */}
                <DocumentViewerProvider>
                  <ShellChrome />
                </DocumentViewerProvider>
              </ErrorBoundary>
            </AgentContextProvider>
          </AgentRuntimeProvider>
        </BaseTooltip.Provider>
      </ToastProvider>
    </ImpersonationProvider>
  );
};

// ── Router (data router — enables router-level Back/Forward blocking) ──────
/**
 * The application's router, as DATA (#1525). `createBrowserRouter` replaces the plain
 * `<BrowserRouter><Routes>` tree so the shared unsaved-changes guard can hold a browser
 * Back/Forward change (`useBlocker` needs a data router): the router reverts the history entry
 * and keeps the form mounted until the user confirms.
 *
 * Every path, layout, redirect, lazy chunk and the `/` + `/*` history envelope is unchanged:
 * the five public pages stay outside the gates, `<RequireAuth>` then `<RequireInviteAccepted>`
 * still wrap `/oauth/consent` and the whole authenticated shell, and the authenticated shell
 * still resolves its own `appRouteConfig` table via `AppRoutes`, exactly as before.
 * `<AnalyticsProvider>` keeps the position it had between the router and the routes (it reads
 * `useLocation`), now as the root layout route.
 */
// eslint-disable-next-line react-refresh/only-export-components -- the entry point creates the one router instance
export const createAppRouter = (): DataRouter => createBrowserRouter([
  {
    element: <AnalyticsProvider><Outlet /></AnalyticsProvider>,
    children: [
      { path: '/login', element: <Suspense fallback={<LoadingFallback />}><LoginPage /></Suspense> },
      { path: '/terms', element: <Suspense fallback={<LoadingFallback />}><TermsPage /></Suspense> },
      { path: '/privacy', element: <Suspense fallback={<LoadingFallback />}><PrivacyPage /></Suspense> },
      { path: '/reset-password', element: <Suspense fallback={<LoadingFallback />}><ResetPasswordPage /></Suspense> },
      { path: '/update-password', element: <UpdatePasswordPage /> },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <RequireInviteAccepted />,
            children: [
              // #728: Supabase's OAuth server sends the browser here to approve an outside
              // client (the PMO CLI). Signed-in only, but outside the app shell.
              { path: '/oauth/consent', element: <OAuthConsentPage /> },
              { path: '/*', element: <Shell /> },
            ],
          },
        ],
      },
    ],
  },
]);

// ── Root (eager — auth layer is never lazy-split) ─────────────────────────
export interface AppProps {
  /**
   * The router instance, created once by the entry point outside React. Tests that mount the root
   * omit it and get a router per mount, so each mount starts from the URL it set up.
   */
  router?: DataRouter;
}

const App: React.FC<AppProps> = ({ router: injectedRouter }) => {
  const [router] = useState<DataRouter>(() => injectedRouter ?? createAppRouter());
  return (
    <>
      {/* Non-prod backend ribbon (renders null in prod) — see VITE_APP_ENV in docs/environments.md. */}
      <EnvBadge />
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          {/* Locale resolution + i18next. Below AuthProvider because it needs the profile; above
              the router because every string-rendering subtree sits under it (FR-L10N-003). */}
          <I18nProvider>
            <RouterProvider router={router} />
          </I18nProvider>
        </AuthProvider>
      </QueryClientProvider>
    </>
  );
};

export default App;
