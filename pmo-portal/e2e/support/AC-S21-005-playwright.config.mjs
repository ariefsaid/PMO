import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repoRoot = path.resolve(appRoot, '..');
const statusResult = spawnSync('supabase', ['status', '-o', 'json'], {
  cwd: repoRoot,
  encoding: 'utf8',
  maxBuffer: 2 * 1024 * 1024,
});
if (statusResult.status !== 0 || statusResult.error) throw new Error('S21_LOCAL_SUPABASE_STATUS_UNAVAILABLE');

let status;
try {
  status = JSON.parse(statusResult.stdout);
} catch {
  throw new Error('S21_LOCAL_SUPABASE_STATUS_INVALID');
}
if (!status.API_URL || !status.ANON_KEY) throw new Error('S21_LOCAL_SUPABASE_CONFIG_UNAVAILABLE');
const localApi = new URL(status.API_URL);
if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(localApi.hostname)) {
  throw new Error('S21_LOCAL_SUPABASE_TARGET_NOT_LOCAL');
}

const resultRoot = path.join(os.tmpdir(), `pmo-s21-playwright-${process.pid}`);
const serverEnv = {
  PATH: process.env.PATH ?? '',
  VITE_SUPABASE_URL: status.API_URL,
  VITE_SUPABASE_ANON_KEY: status.ANON_KEY,
};

export default defineConfig({
  testDir: path.join(appRoot, 'e2e'),
  testMatch: 'AC-S21-005-task-list-review.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'line',
  outputDir: resultRoot,
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    timezoneId: 'Asia/Jakarta',
    locale: 'en-US',
  },
  webServer: {
    command: 'node e2e/support/run-ac-s21-vite.mjs',
    cwd: appRoot,
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: false,
    env: serverEnv,
  },
});
