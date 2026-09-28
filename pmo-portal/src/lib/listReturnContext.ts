import type { ListName } from './listWorkingSet';

export const LIST_RETURN_CONTEXT_KEY = 'pmoListReturn';
export const LIST_SCROLL_RESTORE_STATE_KEY = 'pmoListScrollRestore';

export interface ListReturnContext {
  /** List that was open when the canonical record route was entered. */
  list: ListName;
  /** Exact local list index path, including its query string when present. */
  path: string;
  /** Best-effort main-scroll offset captured from that list entry. */
  scrollTop?: number;
  /** React Router key of the source list entry, used for native Back restoration. */
  sourceLocationKey?: string;
}

export interface ListReturnContextOptions {
  /** A project may be opened from Sales Pipeline while its structural home remains Projects. */
  allowSalesForProject?: boolean;
}

const RECORD_PATHS: Partial<Record<ListName, RegExp>> = {
  projects: /^\/projects\/[^/]+(?:\/[^/]+)?$/u,
  procurement: /^\/procurement\/[^/]+(?:\/[^/]+)?$/u,
  companies: /^\/companies\/[^/]+$/u,
  contacts: /^\/contacts\/[^/]+$/u,
  meetings: /^\/meetings\/[^/]+$/u,
};

const LIST_PATHS: Record<ListName, string> = {
  projects: '/projects',
  sales: '/sales',
  procurement: '/procurement',
  companies: '/companies',
  contacts: '/contacts',
  meetings: '/meetings',
};

const MAX_RETURN_PATH_LENGTH = 4096;
const MAX_SCROLL_TOP = 10_000_000;
const LOCATION_KEY_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
const BASE_ORIGIN = 'https://list-return.invalid';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function listName(value: unknown): value is ListName {
  return typeof value === 'string' && Object.hasOwn(LIST_PATHS, value);
}

function validatedListPath(value: unknown, list: ListName): string | undefined {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_RETURN_PATH_LENGTH ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('#') ||
    value.includes('\\') ||
    /\p{Cc}/u.test(value)
  ) {
    return undefined;
  }

  try {
    const url = new URL(value, BASE_ORIGIN);
    if (
      url.origin !== BASE_ORIGIN ||
      url.pathname !== LIST_PATHS[list] ||
      url.hash !== '' ||
      url.username !== '' ||
      url.password !== ''
    ) {
      return undefined;
    }
    return `${url.pathname}${url.search}`;
  } catch {
    return undefined;
  }
}

function validScrollTop(value: unknown): number | undefined {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_SCROLL_TOP
    ? value
    : undefined;
}

function validLocationKey(value: unknown): string | undefined {
  return typeof value === 'string' && LOCATION_KEY_PATTERN.test(value) ? value : undefined;
}

function allowedForOwner(
  source: ListName,
  owner: ListName,
  options: ListReturnContextOptions,
): boolean {
  return (
    source === owner ||
    (owner === 'projects' && source === 'sales' && options.allowSalesForProject === true)
  );
}

/** Create a return context only from the named list's exact local index route. */
export function createListReturnContext(
  list: ListName,
  path: string,
  scrollTop?: number,
  sourceLocationKey?: string,
): ListReturnContext | undefined {
  const safePath = validatedListPath(path, list);
  if (!safePath) return undefined;
  const safeScrollTop = validScrollTop(scrollTop);
  const safeLocationKey = validLocationKey(sourceLocationKey);
  return {
    list,
    path: safePath,
    ...(safeScrollTop === undefined ? {} : { scrollTop: safeScrollTop }),
    ...(safeLocationKey === undefined ? {} : { sourceLocationKey: safeLocationKey }),
  };
}

/** Read and validate untrusted React Router location.state for this record's owning list. */
export function readListReturnContext(
  state: unknown,
  owner: ListName,
  options: ListReturnContextOptions = {},
): ListReturnContext | undefined {
  if (!isRecord(state)) return undefined;
  const candidate = state[LIST_RETURN_CONTEXT_KEY];
  if (!isRecord(candidate) || !listName(candidate.list)) return undefined;
  if (!allowedForOwner(candidate.list, owner, options)) return undefined;
  return createListReturnContext(
    candidate.list,
    typeof candidate.path === 'string' ? candidate.path : '',
    candidate.scrollTop as number | undefined,
    typeof candidate.sourceLocationKey === 'string' ? candidate.sourceLocationKey : undefined,
  );
}

/** Return a validated in-app context target or the record owner's canonical index. */
export function listReturnPath(
  state: unknown,
  owner: ListName,
  options: ListReturnContextOptions = {},
): string {
  return readListReturnContext(state, owner, options)?.path ?? LIST_PATHS[owner];
}

/** Attach a context to existing router state without discarding unrelated state fields. */
export function withListReturnContext(
  state: unknown,
  context: ListReturnContext,
): Record<string, unknown> {
  const next = isRecord(state) ? { ...state } : {};
  delete next[LIST_RETURN_CONTEXT_KEY];
  const validated = listName(context?.list)
    ? createListReturnContext(
        context.list,
        context.path,
        context.scrollTop,
        context.sourceLocationKey,
      )
    : undefined;
  if (validated) next[LIST_RETURN_CONTEXT_KEY] = validated;
  return next;
}

/** Build explicit-return state while preserving unrelated router fields. */
export function withListScrollRestore(
  state: unknown,
  context: ListReturnContext,
): Record<string, unknown> {
  const next = isRecord(state) ? { ...state } : {};
  delete next[LIST_SCROLL_RESTORE_STATE_KEY];
  const validated = listName(context?.list)
    ? createListReturnContext(
        context.list,
        context.path,
        context.scrollTop,
        context.sourceLocationKey,
      )
    : undefined;
  if (validated?.scrollTop !== undefined) {
    next[LIST_SCROLL_RESTORE_STATE_KEY] = {
      list: validated.list,
      path: validated.path,
      scrollTop: validated.scrollTop,
    };
  }
  return next;
}

/** Resolve only the exact detail routes backed by one of the adopting list indexes. */
export function listReturnOwnerForPathname(pathname: string): ListName | undefined {
  for (const [list, pattern] of Object.entries(RECORD_PATHS) as [ListName, RegExp][]) {
    if (pattern.test(pathname)) return list;
  }
  return undefined;
}

/** Accept only a canonical one-segment record URL for the supplied list owner. */
export function isCanonicalRecordPath(pathname: string, owner: ListName): boolean {
  const segments = pathname.split('/').filter(Boolean);
  return (
    segments.length === 2 &&
    segments[0] === LIST_PATHS[owner].slice(1) &&
    listReturnOwnerForPathname(pathname) === owner
  );
}

/** Resolve the breadcrumb destination only when router state belongs to this record's owner. */
export function contextualListReturnPath(pathname: string, state: unknown): string | undefined {
  const owner = listReturnOwnerForPathname(pathname);
  return owner ? readListReturnContext(state, owner)?.path : undefined;
}
