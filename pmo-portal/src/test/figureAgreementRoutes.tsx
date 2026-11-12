/* eslint-disable no-restricted-imports -- This test-only manifest must import the live page routes under test. */
import type { ComponentType } from 'react';
import ExecutiveDashboard from '@/pages/ExecutiveDashboard';
import ManagementPack from '@/pages/ManagementPack';
import ProcurementDetails from '@/pages/ProcurementDetails';
import ProjectDetail from '@/pages/project-detail/ProjectDetail';
import Projects from '@/pages/Projects';
import FinanceHub from '@/pages/finance/FinanceHub';
import type { Role } from '@/src/auth/AuthContext';
import type { FigureIdentityId } from '@/src/lib/figures/identity';

/** Each entry is a shipped screen import and the URL/role state in which it is exercised. */
export interface FigureAgreementRoute {
  id: string;
  screen: string;
  component: ComponentType;
  matchPath: string;
  location: string;
  role: Role;
  layout?: 'overview' | 'focused';
  view?: 'table' | 'cards' | 'kanban' | 'calendar';
  tab?: string;
  figures: readonly FigureIdentityId[];
  auditRefs: readonly string[];
}

const project = '/projects/project-figure-primary';

export const figureAgreementRouteManifest = [
  {
    id: 'budget.projects.table', screen: 'Projects', component: Projects, matchPath: '/projects',
    location: '/projects?view=table', role: 'Executive', view: 'table',
    figures: ['budget-used', 'spent', 'contract-value'], auditRefs: ['B', 'A1 §1.4 #3', 'A2 F1-R2', 'A2 F10-R1'],
  },
  {
    id: 'budget.projects.cards', screen: 'Projects', component: Projects, matchPath: '/projects',
    location: '/projects?view=cards', role: 'Executive', view: 'cards',
    figures: ['budget-used', 'spent', 'contract-value'], auditRefs: ['B', 'A2 F1-R1', 'A2 F10-R1'],
  },
  {
    id: 'budget.home.pm', screen: 'ExecutiveDashboard → PMDashboard', component: ExecutiveDashboard, matchPath: '/',
    location: '/', role: 'Project Manager', layout: 'overview',
    figures: ['budget-used', 'spent'], auditRefs: ['B', 'A1 §1.4 #1–2', 'A1 §2.12'],
  },
  {
    id: 'budget.home.executive.overview', screen: 'ExecutiveDashboard → CompanyDashboard', component: ExecutiveDashboard, matchPath: '/',
    location: '/', role: 'Executive', layout: 'overview',
    figures: ['budget-used', 'spent'], auditRefs: ['B', 'A2 F1 out-of-area consumers'],
  },
  {
    id: 'budget.home.executive.focused', screen: 'ExecutiveDashboard → CompanyDashboard', component: ExecutiveDashboard, matchPath: '/',
    location: '/', role: 'Executive', layout: 'focused',
    figures: ['budget-used', 'spent'], auditRefs: ['B', 'A1 §2.16'],
  },
  {
    id: 'budget.home.admin.overview', screen: 'ExecutiveDashboard → CompanyDashboard', component: ExecutiveDashboard, matchPath: '/',
    location: '/', role: 'Admin', layout: 'overview',
    figures: ['budget-used', 'spent'], auditRefs: ['B', 'A2 F1 role coverage'],
  },
  {
    id: 'budget.home.admin.focused', screen: 'ExecutiveDashboard → CompanyDashboard', component: ExecutiveDashboard, matchPath: '/',
    location: '/', role: 'Admin', layout: 'focused',
    figures: ['budget-used', 'spent'], auditRefs: ['B', 'A1 §2.16'],
  },
  {
    id: 'budget.home.finance.overview', screen: 'ExecutiveDashboard → CompanyDashboard', component: ExecutiveDashboard, matchPath: '/',
    location: '/', role: 'Finance', layout: 'overview',
    figures: ['budget-used', 'spent'], auditRefs: ['B', 'A2 F1 role coverage'],
  },
  {
    id: 'budget.home.finance.focused', screen: 'ExecutiveDashboard → CompanyDashboard', component: ExecutiveDashboard, matchPath: '/',
    location: '/', role: 'Finance', layout: 'focused',
    figures: ['budget-used', 'spent'], auditRefs: ['B', 'A1 §2.16'],
  },
  {
    id: 'budget.project.overview', screen: 'ProjectDetail · Overview', component: ProjectDetail, matchPath: '/projects/:projectId',
    location: project, role: 'Project Manager', tab: 'overview',
    figures: ['budget-used', 'spent', 'contract-value', 'contract-invoiced'], auditRefs: ['B', 'A2 F1-R2', 'A2 F10-R1', 'I', 'A2 F4-R1', 'A2 F5-R1'],
  },
  {
    id: 'budget.project.budget', screen: 'ProjectDetail · Budget', component: ProjectDetail, matchPath: '/projects/:projectId/:tab',
    location: `${project}/budget`, role: 'Project Manager', tab: 'budget',
    figures: ['budget-used', 'spent', 'budget-left-after-open-orders'], auditRefs: ['B', 'A1 §1.4 #6', 'A2 F1-R2', 'A2 F2-R2'],
  },
  {
    id: 'budget.procurement.record', screen: 'ProcurementDetails', component: ProcurementDetails, matchPath: '/procurement/:procurementId',
    location: '/procurement/purchase-request-s01', role: 'Finance',
    figures: ['budget-used'], auditRefs: ['B', 'A2 F1-R3', 'A2 F17'],
  },
  {
    id: 'billing.home.executive.overview', screen: 'ExecutiveDashboard → CompanyDashboard', component: ExecutiveDashboard, matchPath: '/',
    location: '/', role: 'Executive', layout: 'overview',
    figures: ['billed-work-cumulative', 'billed-work-period'], auditRefs: ['I', 'A1 §1.3 #1–2'],
  },
  {
    id: 'billing.home.executive.focused', screen: 'ExecutiveDashboard → CompanyDashboard', component: ExecutiveDashboard, matchPath: '/',
    location: '/', role: 'Executive', layout: 'focused',
    figures: ['billed-work-cumulative', 'billed-work-period'], auditRefs: ['I', 'A1 §1.3 #1–2'],
  },
  {
    id: 'billing.home.admin.overview', screen: 'ExecutiveDashboard → CompanyDashboard', component: ExecutiveDashboard, matchPath: '/',
    location: '/', role: 'Admin', layout: 'overview',
    figures: ['billed-work-cumulative', 'billed-work-period'], auditRefs: ['I', 'A1 §1.3 #1'],
  },
  {
    id: 'billing.home.admin.focused', screen: 'ExecutiveDashboard → CompanyDashboard', component: ExecutiveDashboard, matchPath: '/',
    location: '/', role: 'Admin', layout: 'focused',
    figures: ['billed-work-cumulative', 'billed-work-period'], auditRefs: ['I', 'A1 §1.3 #1'],
  },
  {
    id: 'billing.home.finance.overview', screen: 'ExecutiveDashboard → CompanyDashboard', component: ExecutiveDashboard, matchPath: '/',
    location: '/', role: 'Finance', layout: 'overview',
    figures: ['billed-work-cumulative', 'billed-work-period'], auditRefs: ['I', 'A1 §1.3 #1–2'],
  },
  {
    id: 'billing.home.finance.focused', screen: 'ExecutiveDashboard → CompanyDashboard', component: ExecutiveDashboard, matchPath: '/',
    location: '/', role: 'Finance', layout: 'focused',
    figures: ['billed-work-cumulative', 'billed-work-period'], auditRefs: ['I', 'A1 §1.3 #1–2'],
  },
  {
    id: 'billing.project.overview', screen: 'ProjectDetail · Overview', component: ProjectDetail, matchPath: '/projects/:projectId',
    location: project, role: 'Project Manager', tab: 'overview',
    figures: ['contract-value', 'contract-invoiced'], auditRefs: ['I', 'A2 F4-R1', 'A2 F5-R1', 'A2 F10-R1'],
  },
  {
    id: 'billing.project.contract', screen: 'ProjectDetail · Contract & billing', component: ProjectDetail, matchPath: '/projects/:projectId/:tab',
    location: `${project}/contract`, role: 'Project Manager', tab: 'contract',
    figures: ['contract-value', 'contract-invoiced', 'contract-left-to-invoice'], auditRefs: ['I', 'A2 F4-R3', 'A2 F5-R2', 'A2 F10-R3'],
  },
  {
    id: 'billing.project.finances', screen: 'ProjectDetail · Overview / Project finances', component: ProjectDetail, matchPath: '/projects/:projectId',
    location: project, role: 'Finance', tab: 'overview',
    figures: ['contract-invoiced', 'billed-work-cumulative', 'invoice-documents'], auditRefs: ['I', 'A2 F4-R2', 'A2 F8-R2', 'A1 §2.18 #2,#5'],
  },
  {
    id: 'billing.reports', screen: 'ManagementPack', component: ManagementPack, matchPath: '/finance/reports',
    location: '/finance/reports?from=2026-11&to=2026-11', role: 'Finance',
    figures: ['billed-work-cumulative', 'billed-work-period', 'contract-left-to-invoice', 'invoice-documents'], auditRefs: ['I', 'A1 §1.3 #3–4', 'A1 §1.8 #4', 'A1 §2.18 #2–5'],
  },
  {
    id: 'billing.finance-hub', screen: 'FinanceHub', component: FinanceHub, matchPath: '/finance',
    location: '/finance', role: 'Finance',
    figures: ['billed-work-cumulative'], auditRefs: ['I', 'A1 §1.3 #5'],
  },
] as const satisfies readonly FigureAgreementRoute[];

export const budgetAgreementRoutes = figureAgreementRouteManifest.filter((route) =>
  route.figures.some((figure) => ['budget-used', 'spent', 'budget-left-after-open-orders'].includes(figure)),
);

export const billingAgreementRoutes = figureAgreementRouteManifest.filter((route) =>
  route.figures.some((figure) => ['contract-invoiced', 'billed-work-cumulative', 'billed-work-period', 'contract-value', 'contract-left-to-invoice', 'invoice-documents'].includes(figure)),
);
