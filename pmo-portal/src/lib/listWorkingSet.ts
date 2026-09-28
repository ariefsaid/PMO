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

function viewValue<T extends string>(
  params: URLSearchParams,
  allowed: readonly T[],
  list: keyof typeof DEFAULT_VIEWS,
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
      view: viewValue(params, PROJECT_VIEWS, 'projects', options.sessionView),
    }),
    serialize: (params, value, options) => {
      const omitFilter = options.projectsDefaultFilter ?? DEFAULT_PROJECT_FILTER;
      putParam(params, 'filter', value.filter, omitFilter);
      putParam(
        params,
        'client',
        referenceValue(value.client === 'All' ? null : value.client),
        'All',
      );
      putParam(params, 'pm', referenceValue(value.pm === 'All' ? null : value.pm), 'All');
      putParam(params, 'q', value.q);
      putParam(params, 'view', value.view, DEFAULT_VIEWS.projects);
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
        view: viewValue(params, SALES_VIEWS, 'sales', options.sessionView),
      };
    },
    serialize: (params, value) => {
      // A Lost scope cannot coexist with an open stage, so it is forced to Open only in that
      // contradictory case; Needs attention + stage round-trips as-is.
      const scope = value.scope === 'Lost' && value.status ? 'Open' : value.scope;
      putParam(params, 'scope', scope, 'Open');
      putParam(params, 'status', value.status);
      putParam(params, 'q', value.q);
      putParam(params, 'view', value.view, DEFAULT_VIEWS.sales);
      return params;
    },
  },
  procurement: {
    parse: (params, options) => {
      const status = procurementStatusValue(params);
      return {
        ...status,
        q: searchValue(params),
        view: viewValue(params, PROCUREMENT_VIEWS, 'procurement', options.sessionView),
      };
    },
    serialize: (params, value) => {
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
      putParam(params, 'view', value.view, DEFAULT_VIEWS.procurement);
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
      putParam(
        params,
        'company',
        referenceValue(value.company === 'All' ? null : value.company),
        'All',
      );
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
      putParam(
        params,
        'project',
        referenceValue(value.project === 'All' ? null : value.project),
        'All',
      );
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

/** Serialize a typed working set while retaining query keys owned by other features. */
export function serializeListWorkingSet<K extends ListName>(
  list: K,
  search: SearchInput,
  workingSet: ListWorkingSetByName[K],
  options: Pick<ListWorkingSetOptions, 'projectsDefaultFilter'> = {},
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