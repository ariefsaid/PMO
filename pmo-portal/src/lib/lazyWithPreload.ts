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
 * the module is fetched once and only once. A rejected import stays cached
 * (same semantics React.lazy gives the render path); the stale-chunk reload
 * guard (`src/lib/chunkReload.ts`) owns recovery.
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
    importPromise ??= factory();
    return importPromise;
  };
  // Hand React.lazy the SAME memoized loader, so the render path and every
  // preload() call share one import promise.
  const component = React.lazy(load) as PreloadableLazy<T>;
  component.preload = load;
  return component;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
