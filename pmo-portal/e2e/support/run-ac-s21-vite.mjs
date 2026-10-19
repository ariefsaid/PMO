import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const privateRoot = await mkdtemp(path.join(os.tmpdir(), 'pmo-s21-vite-'));
const emptyEnvDir = path.join(privateRoot, 'empty-env');
const configPath = path.join(privateRoot, 'vite.config.mjs');
await mkdir(emptyEnvDir);

const baseConfigPath = path.join(appRoot, 'vite.config.ts');
await writeFile(configPath, [
  `import baseConfig from ${JSON.stringify(baseConfigPath)};`,
  'export default {',
  '  ...baseConfig,',
  `  envDir: ${JSON.stringify(emptyEnvDir)},`,
  '  server: { ...baseConfig.server, host: "127.0.0.1", port: 3000, strictPort: true },',
  '};',
].join('\n'));

if (!process.env.VITE_SUPABASE_URL || !process.env.VITE_SUPABASE_ANON_KEY) {
  await rm(privateRoot, { recursive: true, force: true });
  throw new Error('S21_VITE_LOCAL_CONFIG_UNAVAILABLE');
}

const viteCli = path.join(appRoot, 'node_modules/vite/bin/vite.js');
const child = spawn(process.execPath, [viteCli, '--config', configPath], {
  cwd: appRoot,
  env: {
    PATH: process.env.PATH ?? '',
    HOME: privateRoot,
    TMPDIR: privateRoot,
    VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY,
    VITE_APP_ENV: 'test',
    VITE_ANALYTICS_ENABLED: 'false',
  },
  stdio: 'inherit',
});

let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
child.once('error', async () => {
  await rm(privateRoot, { recursive: true, force: true });
  process.exitCode = 1;
});
child.once('exit', async (code) => {
  await rm(privateRoot, { recursive: true, force: true });
  process.exitCode = code ?? 1;
});
