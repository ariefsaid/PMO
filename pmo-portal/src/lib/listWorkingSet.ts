import { VIEWS_STORAGE_KEY } from '../hooks/viewStorage';

export const LIST_VIEW_STORAGE_KEY = VIEWS_STORAGE_KEY;

export type ListName = 'projects' | 'sales' | 'procurement' | 'companies' | 'contacts' | 'meetings';

export type ProjectFilter = 'All' | 'My Projects' | 'Ongoing' | 'Completed' | 'at-risk';
export type SalesScope = 'Open' | 'Lost' | 'Needs attention';
export type SalesStage =
  | ''
  | 'Leads'
  | 'PQ Submitted'
  | 'Quotation Submitted'
  | 'Tender Submitted'
  | 'Negotiation';
export type ProcurementFilterStatus =
  | 'All'
  | 'Needs approval'
  | 'Open'
  | 'Ordered'
  | 'Vendor Invoiced'
  | 'Paid';
export type ProcurementRecordStatus =
  | 'Draft'
  | 'Requested'
  | 'Approved'
  | 'Vendor Quoted'
  | 'Quote Selected'
  | 'Ordered'
  | 'Received'
  | 'Vendor Invoiced'
  | 'Paid'
  | 'Rejected'
  | 'Cancelled';
export type ProcurementStatus = ProcurementFilterStatus | ProcurementRecordStatus;
export type ProcurementStatusMode = 'group' | 'exact';
export type ProjectView = 'table' | 'cards' | 'calendar' | 'kanban';
export type SalesView = 'kanban' | 'table';
export type ProcurementView = 'table' | 'board';
export type CompanyTypeFilter = 'All' | 'Internal' | 'Client' | 'Vendor';

export interface ProjectsWorkingSet {
  filter: ProjectFilter;
  client: string;
  pm: string;
  q: string;
  view: ProjectView;
}

export interface SalesWorkingSet {
  scope: SalesScope;
  status: SalesStage;
  q: string;
  view: SalesView;
}

export interface ProcurementWorkingSet {
  status: ProcurementStatus;
  /** Exact lifecycle status from a dashboard drill, or a broader existing list segment. */
  statusMode: ProcurementStatusMode;
  q: string;
  view: ProcurementView;
}

export interface CompaniesWorkingSet {
  type: CompanyTypeFilter;
  q: string;
}

export interface ContactsWorkingSet {
  company: string;
  q: string;
}

export interface MeetingsWorkingSet {
  project: string;
  q: string;
}

export interface ListWorkingSetByName {
  projects: ProjectsWorkingSet;
  sales: SalesWorkingSet;
  procurement: ProcurementWorkingSet;
  companies: CompaniesWorkingSet;
  contacts: ContactsWorkingSet;
  meetings: MeetingsWorkingSet;
}

export interface ListWorkingSetOptions {
  /** Projects defaults to All, while the Engineer list keeps its My Projects default. */
  projectsDefaultFilter?: ProjectFilter;
  /** Effective persisted view, consulted only when a URL view is absent or invalid. */
  sessionView?: unknown;
}

const PROJECT_FILTERS: readonly ProjectFilter[] = [
  'All',
  'My Projects',
  'Ongoing',
  'Completed',
  'at-risk',
];
const SALES_SCOPES: readonly SalesScope[] = ['Open', 'Lost', 'Needs attention'];
const SALES_STAGES: readonly SalesStage[] = [
  '',
  'Leads',
  'PQ Submitted',
  'Quotation Submitted',
  'Tender Submitted',
  'Negotiation',
];
const PROCUREMENT_FILTER_STATUSES: readonly ProcurementFilterStatus[] = [
  'All',
  'Needs approval',
  'Open',
  'Ordered',
  'Vendor Invoiced',
  'Paid',
];
const PROCUREMENT_RECORD_STATUSES: readonly ProcurementRecordStatus[] = [
  'Draft',
  'Requested',
  'Approved',
  'Vendor Quoted',
  'Quote Selected',
  'Ordered',
  'Received',
  'Vendor Invoiced',
  'Paid',
  'Rejected',
  'Cancelled',
];
const PROJECT_VIEWS: readonly ProjectView[] = ['table', 'cards', 'calendar', 'kanban'];
const SALES_VIEWS: readonly SalesView[] = ['kanban', 'table'];
const PROCUREMENT_VIEWS: readonly ProcurementView[] = ['table', 'board'];
const COMPANY_TYPES: readonly CompanyTypeFilter[] = ['All', 'Internal', 'Client', 'Vendor'];

const DEFAULT_PROJECT_FILTER: ProjectFilter = 'All';
const DEFAULT_VIEWS = {
  projects: 'table',
  sales: 'kanban',
  procurement: 'table',
} as const;

type ViewListName = keyof typeof DEFAULT_VIEWS;
type SearchInput = string | URLSearchParams;

function paramsFrom(input: SearchInput): URLSearchParams {
  return new URLSearchParams(input);
}

function enumValue<T extends string>(
  value: string | null | undefined,
  values: readonly T[],
  fallback: T,
): T {
  return value !== null && value !== undefined && values.includes(value as T)
    ? (value as T)
    : fallback;
}

/**
 * Query-backed identifiers stay visible even when their row is no longer available. The list
 * decides whether they match anything; this codec only excludes empty and control-character data.
 */
function referenceValue(value: string | null): string {
  return value && !/\p{Cc}/u.test(value) ? value : 'All';
}

function searchValue(params: URLSearchParams): string {
  return params.get('q') ?? '';
}

/**
 * Bare lifecycle statuses are exact dashboard drills. Group-prefixed values retain the broader
 * Procurement segment meanings when a segment name overlaps an exact lifecycle status.
 */
function procurementStatusValue(
  params: URLSearchParams,
): Pick<ProcurementWorkingSet, 'status' | 'statusMode'> {
  const token = params.get('status');
  if (token?.startsWith('group:')) {
    return {
      status: enumValue(token.slice('group:'.length), PROCUREMENT_FILTER_STATUSES, 'All'),
      statusMode: 'group',
    };
  }
  if (token !== null && PROCUREMENT_RECORD_STATUSES.includes(token as ProcurementRecordStatus)) {
    return { status: token as ProcurementRecordStatus, statusMode: 'exact' };
  }
  return {
    status: enumValue(token, PROCUREMENT_FILTER_STATUSES, 'All'),
    statusMode: 'group',
  };
}

function viewValue<T extends string>(
  params: URLSearchParams,
  allowed: readonly T[],
  list: ViewListName,
  sessionView: unknown,
): T {
  const explicit = params.get('view');
  const fallback = enumValue(
    typeof sessionView === 'string' ? sessionView : undefined,
    allowed,
    DEFAULT_VIEWS[list] as T,
  );
  // A present but unsupported URL token is invalid input and falls to the page's actual default.
  // Session state is only a fallback when the URL does not own this control.
  if (explicit !== null) return enumValue(explicit, allowed, DEFAULT_VIEWS[list] as T);
  return fallback;
}

/** Parse the six list-specific URL schemas. Unknown keys are intentionally ignored here. */
export function parseListWorkingSet<K extends ListName>(
  list: K,
  search: SearchInput,
  options: ListWorkingSetOptions = {},
): ListWorkingSetByName[K] {
  const params = paramsFrom(search);

  switch (list) {
    case 'projects':
      return {
        filter: enumValue(
          params.get('filter'),
          PROJECT_FILTERS,
          options.projectsDefaultFilter ?? DEFAULT_PROJECT_FILTER,
        ),
        client: referenceValue(params.get('client')),
        pm: referenceValue(params.get('pm')),
        q: searchValue(params),
        view: viewValue(params, PROJECT_VIEWS, 'projects', options.sessionView),
      } as ListWorkingSetByName[K];
    case 'sales': {
      const status = enumValue(params.get('status'), SALES_STAGES, '');
      const requestedScope = enumValue(params.get('scope'), SALES_SCOPES, 'Open');
      return {
        // A selected funnel stage is meaningful only within the open-stage set.
        scope: status ? 'Open' : requestedScope,
        status,
        q: searchValue(params),
        view: viewValue(params, SALES_VIEWS, 'sales', options.sessionView),
      } as ListWorkingSetByName[K];
    }
    case 'procurement': {
      const status = procurementStatusValue(params);
      return {
        ...status,
        q: searchValue(params),
        view: viewValue(params, PROCUREMENT_VIEWS, 'procurement', options.sessionView),
      } as ListWorkingSetByName[K];
    }
    case 'companies':
      return {
        type: enumValue(params.get('type'), COMPANY_TYPES, 'All'),
        q: searchValue(params),
      } as ListWorkingSetByName[K];
    case 'contacts':
      return {
        company: referenceValue(params.get('company')),
        q: searchValue(params),
      } as ListWorkingSetByName[K];
    case 'meetings':
      return {
        project: referenceValue(params.get('project')),
        q: searchValue(params),
      } as ListWorkingSetByName[K];
  }
}

function putParam(params: URLSearchParams, key: string, value: string, omit?: string): void {
  if (value === '' || value === omit) {
    params.delete(key);
    return;
  }
  params.set(key, value);
}

/** Serialize a typed working set while retaining query keys owned by other features. */
export function serializeListWorkingSet<K extends ListName>(
  list: K,
  search: SearchInput,
  workingSet: ListWorkingSetByName[K],
  options: Pick<ListWorkingSetOptions, 'projectsDefaultFilter'> = {},
): URLSearchParams {
  const params = paramsFrom(search);

  switch (list) {
    case 'projects': {
      const value = workingSet as ProjectsWorkingSet;
      const defaultFilter = options.projectsDefaultFilter ?? DEFAULT_PROJECT_FILTER;
      putParam(
        params,
        'filter',
        enumValue(value.filter, PROJECT_FILTERS, defaultFilter),
        defaultFilter,
      );
      putParam(
        params,
        'client',
        referenceValue(value.client === 'All' ? null : value.client),
        'All',
      );
      putParam(params, 'pm', referenceValue(value.pm === 'All' ? null : value.pm), 'All');
      putParam(params, 'q', value.q);
      putParam(
        params,
        'view',
        enumValue(value.view, PROJECT_VIEWS, DEFAULT_VIEWS.projects),
        DEFAULT_VIEWS.projects,
      );
      break;
    }
    case 'sales': {
      const value = workingSet as SalesWorkingSet;
      const status = enumValue(value.status, SALES_STAGES, '');
      const scope = enumValue(value.scope, SALES_SCOPES, 'Open');
      putParam(params, 'scope', status ? 'Open' : scope, 'Open');
      putParam(params, 'status', status);
      putParam(params, 'q', value.q);
      putParam(
        params,
        'view',
        enumValue(value.view, SALES_VIEWS, DEFAULT_VIEWS.sales),
        DEFAULT_VIEWS.sales,
      );
      break;
    }
    case 'procurement': {
      const value = workingSet as ProcurementWorkingSet;
      const exactStatus =
        value.statusMode === 'exact' &&
        PROCUREMENT_RECORD_STATUSES.includes(value.status as ProcurementRecordStatus)
          ? value.status
          : undefined;
      if (exactStatus) {
        putParam(params, 'status', exactStatus);
      } else {
        const groupedStatus = enumValue(value.status, PROCUREMENT_FILTER_STATUSES, 'All');
        const token = PROCUREMENT_RECORD_STATUSES.includes(groupedStatus as ProcurementRecordStatus)
          ? `group:${groupedStatus}`
          : groupedStatus;
        putParam(params, 'status', token, 'All');
      }
      putParam(params, 'q', value.q);
      putParam(
        params,
        'view',
        enumValue(value.view, PROCUREMENT_VIEWS, DEFAULT_VIEWS.procurement),
        DEFAULT_VIEWS.procurement,
      );
      break;
    }
    case 'companies': {
      const value = workingSet as CompaniesWorkingSet;
      putParam(params, 'type', enumValue(value.type, COMPANY_TYPES, 'All'), 'All');
      putParam(params, 'q', value.q);
      break;
    }
    case 'contacts': {
      const value = workingSet as ContactsWorkingSet;
      putParam(
        params,
        'company',
        referenceValue(value.company === 'All' ? null : value.company),
        'All',
      );
      putParam(params, 'q', value.q);
      break;
    }
    case 'meetings': {
      const value = workingSet as MeetingsWorkingSet;
      putParam(
        params,
        'project',
        referenceValue(value.project === 'All' ? null : value.project),
        'All',
      );
      putParam(params, 'q', value.q);
      break;
    }
  }

  return params;
}

/** Resolve controls and their canonical URL together, including a persisted nondefault view. */
export function resolveListWorkingSet<K extends ListName>(
  list: K,
  search: SearchInput,
  options: ListWorkingSetOptions = {},
): { value: ListWorkingSetByName[K]; search: URLSearchParams } {
  const value = parseListWorkingSet(list, search, options);
  return {
    value,
    search: serializeListWorkingSet(list, search, value, options),
  };
}

/** Read the existing per-surface session preference without making it authoritative over a URL. */
export function readListViewPreference(
  list: ViewListName,
  storage?: Pick<Storage, 'getItem'>,
): string | undefined {
  try {
    const target = storage ?? (typeof sessionStorage === 'undefined' ? undefined : sessionStorage);
    const raw = target?.getItem(VIEWS_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const key = list === 'projects' ? 'project' : list === 'sales' ? 'pipeline' : 'procurement';
    const candidate = (parsed as Record<string, unknown>)[key];
    const allowed =
      list === 'projects' ? PROJECT_VIEWS : list === 'sales' ? SALES_VIEWS : PROCUREMENT_VIEWS;
    return typeof candidate === 'string' && allowed.includes(candidate as never)
      ? candidate
      : undefined;
  } catch {
    return undefined;
  }
}
