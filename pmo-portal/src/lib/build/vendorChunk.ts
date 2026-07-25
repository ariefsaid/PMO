/**
 * Vendor-chunk assignment for rollup/rolldown `manualChunks`.
 *
 * Extracted from `vite.config.ts` so it can be UNIT TESTED. It previously lived as an inline
 * closure in the config with no testable seam, and that cost us: the react rule matched the literal
 * `'react-router-dom'`, but the router's actual code has always lived in `node_modules/react-router/`
 * — `react-router-dom` was only a re-export shim. So the router core silently fell OUT of the
 * long-cache `vendor-react` chunk for the whole v7 era, and every test stayed green because nothing
 * asserted on chunking. A rename must never be able to un-chunk a vendor bundle unnoticed again.
 *
 * Matching is anchored to a `node_modules/` path segment: an un-anchored `id.includes('react')`
 * also swallows application files (`src/lib/react-helpers.ts`) and future sibling packages
 * (`react-router-devtools`, `@react-router/*`).
 */

/** Chunk names are stable — they become long-lived browser cache keys. */
export type VendorChunk =
  | 'vendor-react'
  | 'vendor-query'
  | 'vendor-supabase'
  | 'vendor-recharts';

/** Ordered: first match wins. Each entry lists the npm package names that belong to that chunk. */
const CHUNK_PACKAGES: ReadonlyArray<readonly [VendorChunk, readonly string[]]> = [
  // React core + router — changes rarely; long-lived browser cache.
  // `react-router` covers v8 (where `react-router-dom` no longer exists).
  ['vendor-react', ['react', 'react-dom', 'react-router', 'scheduler']],
  ['vendor-query', ['@tanstack/react-query']],
  ['vendor-supabase', ['@supabase/supabase-js', '@supabase/postgrest-js', '@supabase/auth-js']],
  ['vendor-recharts', ['recharts']],
];

/**
 * Returns the vendor chunk for a module id, or `undefined` to leave it to the default splitter.
 * Only `node_modules` ids are ever assigned — application code must not land in a vendor chunk.
 */
export function vendorChunkFor(id: string): VendorChunk | undefined {
  const normalized = id.replaceAll('\\', '/');
  const lastNodeModules = normalized.lastIndexOf('node_modules/');
  if (lastNodeModules === -1) return undefined;

  // The package specifier is what follows the LAST `node_modules/` (handles nested installs).
  const after = normalized.slice(lastNodeModules + 'node_modules/'.length);
  const segments = after.split('/');
  const pkg = segments[0]?.startsWith('@') ? `${segments[0]}/${segments[1]}` : segments[0];
  if (!pkg) return undefined;

  for (const [chunk, packages] of CHUNK_PACKAGES) {
    // Exact package-name match — NOT a substring, so `react-router-devtools` never masquerades
    // as `react-router`, and `react-markdown` never lands in `vendor-react`.
    if (packages.includes(pkg)) return chunk;
  }
  return undefined;
}
