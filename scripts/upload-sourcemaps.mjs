// AC-PHO-011 / FR-PHO-011..013: npm `postbuild` step. Deploy builds upload source maps to PostHog then
// delete them from dist so they are never served; every other build is a visible no-op.
// The CLI runs via npx only on deploy builds, so package-lock.json is untouched.
import { readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { planSourcemapUpload } from './sourcemapPolicy.mjs';

const CLI_VERSION = '0.19.0';

function collectMaps(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? collectMaps(join(dir, e.name)) : e.name.endsWith('.map') ? [join(dir, e.name)] : [],
  );
}

export async function runSourcemapStep({ env, distDir, run, log }) {
  const maps = collectMaps(distDir);
  const plan = planSourcemapUpload(env, maps);
  if (plan.action === 'skip') { log(`sourcemaps ${plan.reason}`); return 0; }
  if (plan.action === 'fail') { log(`sourcemaps FAILED: ${plan.reason}`); return 1; }
  // Same 7-char sha the app registers as `release` (vite.config.ts gitSha).
  const release = (env.CF_PAGES_COMMIT_SHA ?? '').slice(0, 7);
  if (!release) { log('sourcemaps FAILED: CF_PAGES_COMMIT_SHA missing'); return 1; }
  if ((await run(['sourcemap', 'inject', '--directory', distDir])) !== 0) { log('sourcemaps FAILED: inject'); return 1; }
  const up = await run(['sourcemap', 'upload', '--directory', distDir, '--release-name', 'pmo-portal', '--release-version', release]);
  if (up !== 0) { log('sourcemaps FAILED: upload'); return 1; }
  maps.forEach((m) => rmSync(m));
  log(`uploaded ${maps.length} maps for release ${release}`);
  return 0;
}

const spawnCli = (args) =>
  new Promise((res) => spawn('npx', ['--yes', `@posthog/cli@${CLI_VERSION}`, ...args], { stdio: 'inherit' }).on('close', (c) => res(c ?? 1)));

export function isRunAsMain(importMetaUrl, argv1) {
  return importMetaUrl === pathToFileURL(argv1).href;
}

if (isRunAsMain(import.meta.url, process.argv[1])) {
  process.exit(await runSourcemapStep({ env: process.env, distDir: resolve('dist'), run: spawnCli, log: console.log }));
}
