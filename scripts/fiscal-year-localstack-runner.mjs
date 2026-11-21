import { execFileSync, spawnSync } from 'node:child_process';

if (process.env.PMO_DB_LOCK_HELD !== '1') {
  console.error('The local database lock is required.');
  process.exit(1);
}

let status;
try {
  status = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }));
} catch {
  console.error('Local Supabase status is unavailable or invalid.');
  process.exit(1);
}
const { API_URL: apiUrl, SERVICE_ROLE_KEY: serviceKey } = status;
let localUrl;
try { localUrl = new URL(apiUrl); } catch { /* invalid is rejected below */ }
if (typeof apiUrl !== 'string' || !localUrl ||
    localUrl.protocol !== 'http:' || localUrl.hostname !== '127.0.0.1' ||
    localUrl.port !== '54321' || typeof serviceKey !== 'string' || !serviceKey) {
  console.error('Local Supabase status lacks the expected local API or service key.');
  process.exit(1);
}
const test = spawnSync('deno', [
  'test', '--config', 'supabase/functions/erpnext-sweep/deno.json',
  '--allow-env', '--allow-net', '--allow-read',
  'supabase/functions/erpnext-sweep/fiscalYear.localstack.test.ts',
], {
  stdio: 'inherit',
  env: { ...process.env, PMO_LOCAL_SUPABASE_URL: apiUrl, PMO_LOCAL_SERVICE_ROLE_KEY: serviceKey },
});
if (test.error || test.signal || test.status === null) {
  console.error('The local-stack test could not complete.');
  process.exit(1);
}
process.exit(test.status);
