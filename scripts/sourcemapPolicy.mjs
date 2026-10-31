// AC-PHO-011: decide whether this build uploads source maps. Pure; no I/O.
// Variable names are the PostHog CLI's own documented ones (an interface of a third-party tool).
export const CREDENTIAL_VARS = ['POSTHOG_CLI_API_KEY', 'POSTHOG_CLI_PROJECT_ID'];

/** Only a Cloudflare Pages production build deploys; CI `verify`, forks and local builds do not. */
export function isDeployBuild(env) {
  return env.CF_PAGES === '1' && env.CF_PAGES_BRANCH === 'production';
}

export function planSourcemapUpload(env, mapFiles) {
  if (!isDeployBuild(env)) return { action: 'skip', reason: 'skipped: not a deploy build' };
  const missing = CREDENTIAL_VARS.filter((v) => !env[v]);
  if (missing.length) return { action: 'fail', reason: `deploy build is missing ${missing.join(', ')}` };
  if (mapFiles.length === 0) return { action: 'fail', reason: 'deploy build produced no source maps' };
  return { action: 'upload' };
}
