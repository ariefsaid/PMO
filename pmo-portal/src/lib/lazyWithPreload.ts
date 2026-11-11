import * as React from 'react';

/**
 * lazyWithPreload — `React.lazy` plus an idempotent `preload()` (#1834).
 *
 * The app renders every route through `React.lazy`, so a route's code starts
 * downloading only when the route element first renders — and in-page late
 * chunks (MinutesEditor, project tabs) start only after their data arrives.
 * On a slow machine those serialise into visible spinners.
 *
 * `lazyWithPreload(() => import('./Page'))` returns the same lazy component
 * React.lazy would give, with one extra static: `preload()`. It kicks off the
 * import immediately (nav-link hover/focus/pointerdown, route entry) and is
 * memoized: the first call starts ONE import, every later call — including
 * React.lazy's own when the route then renders — awaits the same promise, so
 * the module is fetched once and only once. A rejected import does NOT stay
 * cached: the memo resets on rejection and the error is rethrown, so a later
 * `preload()` — or the first render path, which calls the loader fresh —
 * retries the import instead of inheriting a hover preload's failure on a
 * flaky connection. The rethrown rejection still reaches the stale-chunk
 * reload guard (`src/lib/chunkReload.ts`) through the void call sites, and a
 * failure React's own lazy payload already consumed (it caches rejections per
 * component) keeps that guard as its recovery.
 */
// The `any` props bound mirrors React.lazy's own signature (<T extends
// ComponentType<any>>); anything stricter breaks variance for concrete
// forwardRef components and erases their props at usage sites.
/* eslint-disable @typescript-eslint/no-explicit-any -- mirrors React.lazy's own bound */
type ModuleWithDefault<T extends React.ComponentType<any>> = { default: T };

export type PreloadableLazy<T extends React.ComponentType<any>> =
  React.LazyExoticComponent<T> & {
    /** Start (or join) the module's import. Safe to call any number of times. */
    preload: () => Promise<ModuleWithDefault<T>>;
  };

export function lazyWithPreload<T extends React.ComponentType<any>>(
  factory: () => Promise<ModuleWithDefault<T>>,
): PreloadableLazy<T> {
  let importPromise: Promise<ModuleWithDefault<T>> | null = null;
  const load = (): Promise<ModuleWithDefault<T>> => {
    if (importPromise === null) {
      // A rejected import must not stay cached: null the memo (and rethrow) so
      // the next preload() or first render retries the import instead of
      // inheriting a flaky-connection failure forever. Nothing else can have
      // replaced the memo in between — it is only ever set here or nulled here.
      importPromise = factory().catch((error: unknown) => {
        importPromise = null;
        throw error;
      });
    }
    return importPromise;
  };
  // Hand React.lazy the SAME memoized loader, so the render path and every
  // preload() call share one import promise.
  const component = React.lazy(load) as PreloadableLazy<T>;
  component.preload = load;
  return component;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
