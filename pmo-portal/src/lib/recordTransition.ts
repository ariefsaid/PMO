import { prefersReducedMotion } from '@/src/lib/motion';

/**
 * List row → record header morph (#2148), on the browser's View Transitions.
 *
 * The row's title and the record page's title share one `view-transition-name` (`record-<id>`),
 * and only ONE element per page state carries it, so the browser never sees a duplicate name. The
 * list marks its title elements with `data-record-title="<id>"`; opening a record claims that one
 * element just before the navigation starts. Timings live in `index.css` (`--motion-record-*`).
 */

const TITLE_ATTR = 'data-record-title';
const DIRECTION_ATTR = 'data-record-transition';

/** The last record opened (or left) through a transition, so a list that mounts on return can re-claim its row. */
let lastRecordId: string | null = null;
let clearTimer: ReturnType<typeof setTimeout> | undefined;

export type RecordTransitionDirection = 'in' | 'out';

export const recordTransitionName = (id: string): string => `record-${id.replace(/[^a-zA-Z0-9_-]/g, '')}`;

export const supportsViewTransitions = (): boolean =>
  typeof document !== 'undefined' &&
  typeof (document as Document & { startViewTransition?: unknown }).startViewTransition === 'function';

/** True only where a transition may run: the API exists AND the person has not asked for reduced motion. */
export const recordTransitionAllowed = (): boolean => supportsViewTransitions() && !prefersReducedMotion();

const setName = (el: HTMLElement, name: string | null): void => {
  if (name) el.style.setProperty('view-transition-name', name);
  else el.style.removeProperty('view-transition-name');
};

/** The record id in a canonical `/module/:id` path, or undefined. */
export const recordIdFromPath = (path: string): string | undefined => {
  const match = /^\/[^/?#]+\/([^/?#]+)\/?(?:[?#].*)?$/.exec(path);
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
};

/**
 * Prepare a transition for `id`: name only that record's title element, clear any other, and tell the
 * stylesheet which way the page is going (leaving a record runs about 20% shorter).
 */
export function claimRecordTitle(id: string, direction: RecordTransitionDirection): void {
  if (typeof document === 'undefined') return;
  lastRecordId = id;
  document.querySelectorAll<HTMLElement>(`[${TITLE_ATTR}]`).forEach((el) => {
    setName(el, el.getAttribute(TITLE_ATTR) === id ? recordTransitionName(id) : null);
  });
  document.documentElement.setAttribute(DIRECTION_ATTR, direction);
  if (clearTimer) clearTimeout(clearTimer);
  clearTimer = setTimeout(() => document.documentElement.removeAttribute(DIRECTION_ATTR), 600);
}

/** Ref callback for a list's title element: on a list that mounts as the target of a Back, re-claim the row just left. */
export function applyReturnedRecordTitle(id: string, el: HTMLElement | null): void {
  if (el && id === lastRecordId && el.getAttribute(TITLE_ATTR) === id) setName(el, recordTransitionName(id));
}

/** Test seam. */
export function resetRecordTransition(): void {
  lastRecordId = null;
  if (clearTimer) clearTimeout(clearTimer);
  if (typeof document !== 'undefined') document.documentElement.removeAttribute(DIRECTION_ATTR);
}
