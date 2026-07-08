/**
 * Build-time product version identity (ADR-0042 §4).
 *
 * These three tokens are inlined by Vite's `define` in `vite.config.ts`:
 *   - `__APP_VERSION__` ← `pmo-portal/package.json#version`
 *   - `__GIT_SHA__`     ← `CF_PAGES_COMMIT_SHA` (prod) or `git rev-parse --short HEAD`
 *   - `__BUILD_TIME__`  ← ISO timestamp at build start
 *
 * In the Vitest unit environment the `define` replacement does NOT run, so the
 * tokens resolve as bare globals (defaulted in `test/setup.ts`, overridden per
 * test via `vi.stubGlobal` + `vi.resetModules`). In a real build they are
 * statically replaced — there is no runtime cost.
 */

export const APP_VERSION = __APP_VERSION__;
export const GIT_SHA = __GIT_SHA__;
export const BUILD_TIME = __BUILD_TIME__;

/** Human "what's live" label, e.g. "v0.2.0 · a1b2c3d". */
export const VERSION_LABEL = `v${APP_VERSION} · ${GIT_SHA}`;
