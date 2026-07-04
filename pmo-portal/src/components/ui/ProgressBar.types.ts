/**
 * ProgressBar's tone union, split into its own pure (no-React, no-JSX) sibling file.
 * See KPITile.types.ts for the full rationale (viewspec/registry.ts + Deno edge-function
 * deno-check reachability — this is the identical pattern for the second tone type).
 */
export type ProgressTone = 'success' | 'warning' | 'destructive' | 'primary';
