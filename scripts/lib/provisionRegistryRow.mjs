/** provisionRegistryRow.mjs — public-safe docs/environments.md registry row builder (FR-PROV-009). */
export function buildRegistryRow({ slug, projectRef, apiUrl, anonKey, frontendUrl }) {
  return `| \`${slug}\` (cloud) | \`${projectRef}\` | \`${apiUrl}\` | ${anonKey} | ${frontendUrl} | migrations: current | seed: none |`;
}
