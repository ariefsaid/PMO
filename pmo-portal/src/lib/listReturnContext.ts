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
}

declare const validatedReturnNavigation: unique symbol;

/**
 * A validated explicit-return destination: the list path to navigate to plus its router state.
 * Branded so only `listReturnNavigation` / `contextualListReturnNavigation` can create one; a
 * hand-built `{ path, state }` does not type-check where a validated return is required.
 */
export interface ListReturnNavigation {
  readonly path: string;
  readonly state: Record<string, unknown>;
  readonly [validatedReturnNavigation]: true;
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
const BASE_ORIGIN = 'https://list-return.invalid';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function listName(value: unknown): value is ListName {
  return typeof value === 'string' && Object.hasOwn(LIST_PATHS, value);
}

/** The canonical local index route for a named list. */
export function listIndexPath(list: ListName): string {
  return LIST_PATHS[list];
}

/**
 * Capture-only rule: whether a mounted source list may open (and stamp its context onto) a record
 * owned by `owner`. Sales Pipeline opens Projects records, so that one cross-owner pair is allowed
 * here. This is NOT a return rule — reading context is owner-only (see `readListReturnContext`),
 * so a project's BackBar/breadcrumb never returns to Sales; only its Sales Pipeline link reads the
 * Sales context, via `listReturnNavigation(state, 'sales')`.
 */
export function canCaptureFromList(source: ListName, owner: ListName): boolean {
  return source === owner || (owner === 'projects' && source === 'sales');
}

/**
 * Validate an untrusted path as a safe, same-origin, relative local URL. Rejects protocol-relative
 * values (as written or after dot-segment normalisation), cross-origin values, fragments,
 * backslashes, control characters, over-long values, and non-leading-slash input. Returns the
 * normalized `pathname?query` or undefined. Shared by list context validation and record-target
 * validation (which additionally checks the exact path shape).
 */
export function safeLocalPath(value: unknown): string | undefined {
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
      url.hash !== '' ||
      url.username !== '' ||
      url.password !== '' ||
      // Dot segments are resolved by URL parsing, so check the normalised path as well.
      url.pathname.startsWith('//')
    ) {
      return undefined;
    }
    return `${url.pathname}${url.search}`;
  } catch {
    return undefined;
  }
}

function validatedListPath(value: unknown, list: ListName): string | undefined {
  const safe = safeLocalPath(value);
  if (!safe) return undefined;
  const url = new URL(safe, BASE_ORIGIN);
  if (url.pathname !== LIST_PATHS[list]) return undefined;
  return `${url.pathname}${url.search}`;
}

function validScrollTop(value: unknown): number | undefined {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_SCROLL_TOP
    ? value
    : undefined;
}

/** Create a return context only from the named list's exact local index route. */
export function createListReturnContext(
  list: ListName,
  path: string,
  scrollTop?: number,
): ListReturnContext | undefined {
  const safePath = validatedListPath(path, list);
  if (!safePath) return undefined;
  const safeScrollTop = validScrollTop(scrollTop);
  return {
    list,
    path: safePath,
    ...(safeScrollTop === undefined ? {} : { scrollTop: safeScrollTop }),
  };
}

/**
 * Read and validate untrusted React Router location.state for exactly the list named by `owner`.
 * A context captured from any other list (including Sales for a Projects record) is ignored, so
 * the caller falls back to its owner's index.
 */
export function readListReturnContext(
  state: unknown,
  owner: ListName,
): ListReturnContext | undefined {
  if (!isRecord(state)) return undefined;
  const candidate = state[LIST_RETURN_CONTEXT_KEY];
  if (!isRecord(candidate) || !listName(candidate.list)) return undefined;
  if (candidate.list !== owner) return undefined;
  return createListReturnContext(
    candidate.list,
    typeof candidate.path === 'string' ? candidate.path : '',
    candidate.scrollTop as number | undefined,
  );
}

/** Attach a context to existing router state without discarding unrelated state fields. */
export function withListReturnContext(
  state: unknown,
  context: ListReturnContext,
): Record<string, unknown> {
  const next = isRecord(state) ? { ...state } : {};
  delete next[LIST_RETURN_CONTEXT_KEY];
  const validated = listName(context?.list)
    ? createListReturnContext(context.list, context.path, context.scrollTop)
    : undefined;
  if (validated) next[LIST_RETURN_CONTEXT_KEY] = validated;
  return next;
}

/**
 * Build explicit-return state while preserving unrelated router fields. Always strips both seam
 * keys (so `pmoListReturn` is never carried onto the returned list entry, and a stale restore is
 * cleared), then adds a validated one-shot scroll restore only when the context has an offset.
 */
export function withListScrollRestore(
  state: unknown,
  context?: ListReturnContext,
): Record<string, unknown> {
  const next = isRecord(state) ? { ...state } : {};
  delete next[LIST_RETURN_CONTEXT_KEY];
  delete next[LIST_SCROLL_RESTORE_STATE_KEY];
  const validated = context && listName(context.list)
    ? createListReturnContext(context.list, context.path, context.scrollTop)
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

/**
 * Resolve a validated explicit-return destination for a record owner: the captured list path (or
 * the owner index) plus the clean return state (unrelated state preserved, no `pmoListReturn`, a
 * one-shot restore only when an offset exists). Shared by the mobile BackBar and the desktop
 * parent breadcrumb so both push identical clean return entries.
 */
export function listReturnNavigation(
  state: unknown,
  owner: ListName,
): ListReturnNavigation {
  const context = readListReturnContext(state, owner);
  // The single place a validated descriptor is minted (the brand exists only at the type level).
  return {
    path: context?.path ?? listIndexPath(owner),
    state: withListScrollRestore(state, context),
  } as ListReturnNavigation;
}

/** Resolve the breadcrumb destination only when router state belongs to this record's owner. */
export function contextualListReturnNavigation(
  pathname: string,
  state: unknown,
): ListReturnNavigation | undefined {
  const owner = listReturnOwnerForPathname(pathname);
  return owner ? listReturnNavigation(state, owner) : undefined;
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