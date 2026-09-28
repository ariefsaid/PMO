import type { ProjectView } from '../hooks/useProjectView';
import type { PipelineView } from '../hooks/usePipelineView';
import type { ProcurementView } from '../hooks/useProcurementView';
import { ProcurementStatus } from '../../types';
import { OPEN_FUNNEL_STAGES, type OpenFunnelStage } from '../../components/salesPipeline';

export type ListName = 'projects' | 'sales' | 'procurement' | 'companies' | 'contacts' | 'meetings';

export type ProjectFilter = 'All' | 'My Projects' | 'Ongoing' | 'Completed' | 'at-risk';
export type SalesScope = 'Open' | 'Lost' | 'Needs attention';
export type SalesStage = '' | OpenFunnelStage;
export type ProcurementFilterStatus =
  | 'All'
  | 'Needs approval'
  | 'Open'
  | 'Ordered'
  | 'Vendor Invoiced'
  | 'Paid';
export type ProcurementRecordStatus = ProcurementStatus;
export type ProcurementStatusMode = 'group' | 'exact';
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
  view: PipelineView;
}

export interface ProcurementWorkingSet {
  status: ProcurementFilterStatus | ProcurementRecordStatus;
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

const PROJECT_FILTERS = [
  'All',
  'My Projects',
  'Ongoing',
  'Completed',
  'at-risk',
] as const satisfies readonly ProjectFilter[];
const SALES_SCOPES = ['Open', 'Lost', 'Needs attention'] as const satisfies readonly SalesScope[];
const SALES_STAGES = ['', ...OPEN_FUNNEL_STAGES] as readonly SalesStage[];

const PROCUREMENT_FILTER_STATUSES = [
  'All',
  'Needs approval',
  'Open',
  'Ordered',
  'Vendor Invoiced',
  'Paid',
] as const satisfies readonly ProcurementFilterStatus[];
const PROJECT_VIEWS = [
  'table',
  'cards',
  'calendar',
  'kanban',
] as const satisfies readonly ProjectView[];
const SALES_VIEWS = ['kanban', 'table'] as const satisfies readonly PipelineView[];
const PROCUREMENT_VIEWS = ['table', 'board'] as const satisfies readonly ProcurementView[];
const COMPANY_TYPES = [
  'All',
  'Internal',
  'Client',
  'Vendor',
] as const satisfies readonly CompanyTypeFilter[];

/** Exact lifecycle statuses, derived from the enum so a new DB status can never drop out. */
const PROCUREMENT_RECORD_STATUSES = Object.values(ProcurementStatus);
/**
 * Filter statuses whose plain token denotes the broad segment (group mode === exact result set).
 * Only `Ordered` needs the `group:` prefix because its segment result set differs from the exact
 * `Ordered` lifecycle status.
 */
const SEGMENT_PLAIN_STATUSES: readonly string[] = [
  'All',
  'Needs approval',
  'Open',
  'Vendor Invoiced',
  'Paid',
];

const DEFAULT_PROJECT_FILTER: ProjectFilter = 'All';
const DEFAULT_VIEWS = {
  projects: 'table',
  sales: 'kanban',
  procurement: 'table',
} as const;
const VIEWS: { [L in ViewList]: readonly string[] } = {
  projects: PROJECT_VIEWS,
  sales: SALES_VIEWS,
  procurement: PROCUREMENT_VIEWS,
};

/** The lists whose body layout is a URL-owned `view`. */
type ViewList = keyof typeof DEFAULT_VIEWS;

function isViewList(list: ListName): list is ViewList {
  return Object.hasOwn(DEFAULT_VIEWS, list);
}

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
 * Procurement segment meanings when a segment name overlaps an exact lifecycle status. Only the
 * `Ordered` segment differs from its exact status, so only it carries the `group:` prefix; the
 * other segment statuses (Vendor Invoiced, Paid, Open, Needs approval, All) round-trip as plain
 * tokens because their group and exact result sets are identical.
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
  if (token !== null && SEGMENT_PLAIN_STATUSES.includes(token)) {
    return { status: token as ProcurementFilterStatus, statusMode: 'group' };
  }
  if (token !== null && PROCUREMENT_RECORD_STATUSES.includes(token as ProcurementStatus)) {
    return { status: token as ProcurementRecordStatus, statusMode: 'exact' };
  }
  return {
    status: enumValue(token, PROCUREMENT_FILTER_STATUSES, 'All'),
    statusMode: 'group',
  };
}

/** The effective stored view: a valid session view, else the list's default. */
function storedView(list: ViewList, sessionView: unknown): string {
  return enumValue(
    typeof sessionView === 'string' ? sessionView : undefined,
    VIEWS[list],
    DEFAULT_VIEWS[list],
  );
}

function viewValue<T extends string>(
  params: URLSearchParams,
  list: ViewList,
  sessionView: unknown,
): T {
  const explicit = params.get('view');
  // A present but unsupported URL token is invalid input and falls to the page's actual default.
  // Session state is only a fallback when the URL does not own this control.
  if (explicit !== null) return enumValue(explicit, VIEWS[list], DEFAULT_VIEWS[list]) as T;
  return storedView(list, sessionView) as T;
}

/**
 * Write `view` unless omitting it reproduces the same effective view: omit only when the value is
 * the default AND the stored fallback is the default too. A nondefault view is always materialized
 * (a copied link describes what is visible), and a view that differs from a nondefault stored view
 * is written explicitly so the session fallback cannot snap it back.
 */
function putView(params: URLSearchParams, list: ViewList, view: string, sessionView: unknown): void {
  const fallbackIsDefault = storedView(list, sessionView) === DEFAULT_VIEWS[list];
  putParam(params, 'view', view, fallbackIsDefault ? DEFAULT_VIEWS[list] : undefined);
}

function putParam(params: URLSearchParams, key: string, value: string, omit?: string): void {
  if (value === '' || value === omit) {
    params.delete(key);
    return;
  }
  params.set(key, value);
}

interface ListSchema<K extends ListName> {
  parse(params: URLSearchParams, options: ListWorkingSetOptions): ListWorkingSetByName[K];
  serialize(
    params: URLSearchParams,
    value: ListWorkingSetByName[K],
    options: ListWorkingSetOptions,
  ): URLSearchParams;
}

type Schemas = { [K in ListName]: ListSchema<K> };

/**
 * One table of parse/serialize pairs, keyed by list name — six explicit, type-checked codecs,
 * not a framework. Parsers validate untrusted URL input; serializers trust their already-typed
 * working set and only omit/default-encode values (they never re-validate enum membership).
 */
const LIST_WORKING_SET_SCHEMAS: Schemas = {
  projects: {
    parse: (params, options) => ({
      filter: enumValue(
        params.get('filter'),
        PROJECT_FILTERS,
        options.projectsDefaultFilter ?? DEFAULT_PROJECT_FILTER,
      ),
      client: referenceValue(params.get('client')),
      pm: referenceValue(params.get('pm')),
      q: searchValue(params),
      view: viewValue(params, 'projects', options.sessionView),
    }),
    serialize: (params, value, options) => {
      const omitFilter = options.projectsDefaultFilter ?? DEFAULT_PROJECT_FILTER;
      putParam(params, 'filter', value.filter, omitFilter);
      putParam(params, 'client', value.client, 'All');
      putParam(params, 'pm', value.pm, 'All');
      putParam(params, 'q', value.q);
      putView(params, 'projects', value.view, options.sessionView);
      return params;
    },
  },
  sales: {
    parse: (params, options) => {
      const status = enumValue(params.get('status'), SALES_STAGES, '');
      const requestedScope = enumValue(params.get('scope'), SALES_SCOPES, 'Open');
      return {
        // Only a Lost scope conflicts with an open funnel stage. "Needs attention" and an open
        // stage are a valid combination today (SalesPipeline intersects them), so request flow
        // forces Open scope only when Lost was requested together with an open stage.
        scope: status && requestedScope === 'Lost' ? 'Open' : requestedScope,
        status,
        q: searchValue(params),
        view: viewValue(params, 'sales', options.sessionView),
      };
    },
    serialize: (params, value, options) => {
      // A Lost scope cannot coexist with an open stage, so it is forced to Open only in that
      // contradictory case; Needs attention + stage round-trips as-is.
      const scope = value.scope === 'Lost' && value.status ? 'Open' : value.scope;
      putParam(params, 'scope', scope, 'Open');
      putParam(params, 'status', value.status);
      putParam(params, 'q', value.q);
      putView(params, 'sales', value.view, options.sessionView);
      return params;
    },
  },
  procurement: {
    parse: (params, options) => {
      const status = procurementStatusValue(params);
      return {
        ...status,
        q: searchValue(params),
        view: viewValue(params, 'procurement', options.sessionView),
      };
    },
    serialize: (params, value, options) => {
      if (value.statusMode === 'exact') {
        // An exact lifecycle drill stays a bare status token (no group: prefix).
        putParam(params, 'status', value.status);
      } else {
        // Broad segment mode: only Ordered's results differ from its exact status, so only it
        // carries the group: prefix; the other segments serialize as their plain tokens.
        if (value.status === 'Ordered') {
          putParam(params, 'status', 'group:Ordered', 'All');
        } else {
          putParam(params, 'status', value.status, 'All');
        }
      }
      putParam(params, 'q', value.q);
      putView(params, 'procurement', value.view, options.sessionView);
      return params;
    },
  },
  companies: {
    parse: (params) => ({
      type: enumValue(params.get('type'), COMPANY_TYPES, 'All'),
      q: searchValue(params),
    }),
    serialize: (params, value) => {
      putParam(params, 'type', value.type, 'All');
      putParam(params, 'q', value.q);
      return params;
    },
  },
  contacts: {
    parse: (params) => ({
      company: referenceValue(params.get('company')),
      q: searchValue(params),
    }),
    serialize: (params, value) => {
      putParam(params, 'company', value.company, 'All');
      putParam(params, 'q', value.q);
      return params;
    },
  },
  meetings: {
    parse: (params) => ({
      project: referenceValue(params.get('project')),
      q: searchValue(params),
    }),
    serialize: (params, value) => {
      putParam(params, 'project', value.project, 'All');
      putParam(params, 'q', value.q);
      return params;
    },
  },
};

/** Parse the six list-specific URL schemas. Unknown keys are intentionally ignored here. */
export function parseListWorkingSet<K extends ListName>(
  list: K,
  search: SearchInput,
  options: ListWorkingSetOptions = {},
): ListWorkingSetByName[K] {
  return LIST_WORKING_SET_SCHEMAS[list].parse(paramsFrom(search), options);
}

/**
 * Serialize a typed working set while retaining query keys owned by other features. Pass the same
 * `sessionView` the page parses with, so a view that differs from the stored fallback is written.
 */
export function serializeListWorkingSet<K extends ListName>(
  list: K,
  search: SearchInput,
  workingSet: ListWorkingSetByName[K],
  options: ListWorkingSetOptions = {},
): URLSearchParams {
  return LIST_WORKING_SET_SCHEMAS[list].serialize(paramsFrom(search), workingSet, options);
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

/**
 * The only URL write a list makes without a user action. When the URL carries no explicit `view`
 * and the effective session view is valid and nondefault, return the search with that view added,
 * so a copied link reproduces what is visible. Otherwise return `search` exactly as given: no
 * other key is canonicalized, so an explicit drill filter that equals the role default, or an
 * explicit (even invalid) view token, is never rewritten.
 */
export function materializeSessionView(list: ListName, search: string, sessionView: unknown): string {
  if (!isViewList(list)) return search;
  const params = paramsFrom(search);
  if (params.has('view')) return search;
  const view = storedView(list, sessionView);
  if (view === DEFAULT_VIEWS[list]) return search;
  params.set('view', view);
  return `?${params.toString()}`;
}
