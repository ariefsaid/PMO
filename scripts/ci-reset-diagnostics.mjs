#!/usr/bin/env node
// Bounded, redacted diagnostics for a failed `supabase db reset` (#1196).
//
// The failure this answers: migrations + seed succeed, then "Restarting containers..." and the
// reset aborts with `Error status 502: An invalid response was received from the upstream server`.
// That single line says Kong could not reach a service but not WHICH one, and no browser cases ran,
// so the run carried no evidence at all.
//
// Design constraints (issue #1196, binding):
//   * Failure-only. The caller gates this on the reset step's own failure; nothing runs on green.
//   * Bounded. Container count, per-field length and report length are all capped.
//   * Allow-listed data only. Docker is queried with explicit `--format` field templates for
//     container state/health/exit facts. No logs, no environment, no mounted paths, no requests
//     that return rows, and no raw response bodies.
//   * Redacted anyway. Every rendered value passes through `redact()` as defence in depth.
//   * Never changes the job outcome. A collection or write failure is reported on stderr and the
//     process still exits 0, so the already-failed reset step remains the only failure.
//
// Usage: node scripts/ci-reset-diagnostics.mjs [--out <path>]
import { mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const DEFAULT_LIMITS = Object.freeze({
  maxContainers: 30,
  maxFieldChars: 200,
  maxNoteChars: 240,
  maxReportChars: 12_000,
  execTimeoutMs: 5_000,
  probeTimeoutMs: 3_000,
});

export const CONTAINER_NAME_FILTER = 'name=supabase_';

// The ONLY container facts this helper is allowed to read. `docker inspect` without a template
// prints environment variables and mounts; a field template keeps the read to this allow-list.
export const INSPECT_TEMPLATE = [
  '{{.Name}}',
  '{{.State.Status}}',
  '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}',
  '{{.State.ExitCode}}',
  '{{.State.OOMKilled}}',
  '{{.RestartCount}}',
  '{{.State.StartedAt}}',
  '{{.State.FinishedAt}}',
].join('|');

// Local-stack health endpoints behind the same Kong port the reset polls. Only the status code is
// kept: `/rest/v1/` returns an error document and storage answers auth challenges, and neither body
// is needed to know which upstream Kong could not reach.
export const DEFAULT_PROBE_URLS = Object.freeze([
  'http://127.0.0.1:54321/auth/v1/health',
  'http://127.0.0.1:54321/rest/v1/',
  'http://127.0.0.1:54321/storage/v1/status',
]);

const REDACTIONS = [
  [/eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, '[redacted-jwt]'],
  [/\b(?:sbp|sb_secret|sb_publishable)_[A-Za-z0-9_-]{6,}/g, '[redacted-key]'],
  [/\bpostgres(?:ql)?:\/\/\S+/gi, '[redacted-db-url]'],
  [/\bBearer\s+[A-Za-z0-9._-]{8,}/gi, 'Bearer [redacted]'],
  [/\b[A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD)\s*=\s*\S+/g, '[redacted-env]'],
  [/\b(?:service[_-]?role[_-]?key|anon[_-]?key|api[_-]?key|apikey|password|secret|token)\b\s*[:=]\s*\S+/gi, '[redacted]'],
];

/** Mask credential-shaped text. Applied to every value before it can reach a report. */
export function redact(value) {
  let text = typeof value === 'string' ? value : String(value ?? '');
  for (const [pattern, replacement] of REDACTIONS) text = text.replace(pattern, replacement);
  return text;
}

/** Redact, flatten to one line, and bound a single field. Empty values become `unknown`. */
export function sanitizeField(value, maxChars = DEFAULT_LIMITS.maxFieldChars) {
  const flattened = redact(value)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!flattened) return 'unknown';
  if (flattened.length <= maxChars) return flattened;
  return `${flattened.slice(0, Math.max(0, maxChars - 1))}…`;
}

function cell(value, maxChars) {
  return sanitizeField(value, maxChars).replace(/\|/g, '\\|');
}

/** Parse one `INSPECT_TEMPLATE` line into allow-listed, sanitized state fields. */
export function parseInspect(output, limits = DEFAULT_LIMITS) {
  const line = String(output ?? '').split('\n').map((entry) => entry.trim()).find(Boolean);
  if (!line) return null;
  const parts = line.split('|');
  if (parts.length !== 8) return null;
  const [rawName, state, health, exitCode, oomKilled, restarts, startedAt, finishedAt] = parts;
  return {
    name: sanitizeField(rawName.replace(/^\//, ''), limits.maxFieldChars),
    state: sanitizeField(state, limits.maxFieldChars),
    health: sanitizeField(health, limits.maxFieldChars),
    exitCode: sanitizeField(exitCode, 50),
    oomKilled: sanitizeField(oomKilled, 50),
    restarts: sanitizeField(restarts, 50),
    startedAt: sanitizeField(startedAt, limits.maxFieldChars),
    finishedAt: sanitizeField(finishedAt, limits.maxFieldChars),
  };
}

function defaultExec(args) {
  return spawnSync('docker', args, {
    encoding: 'utf8',
    timeout: DEFAULT_LIMITS.execTimeoutMs,
    maxBuffer: 1024 * 1024,
  });
}

function succeeded(result) {
  return Boolean(result) && !result.error && result.status === 0;
}

function firstFailureLine(result, limits) {
  const raw = result?.error?.message || result?.stderr || result?.stdout || 'unknown error';
  const line = String(raw).split('\n').map((entry) => entry.trim()).find(Boolean) ?? 'unknown error';
  return sanitizeField(line, limits.maxNoteChars);
}

/**
 * Snapshot every `supabase_*` container's state/health/exit facts.
 * Returns `{ containers, notes }`; collection problems become notes, never exceptions.
 */
export function collectContainerDiagnostics({ exec = defaultExec, limits = DEFAULT_LIMITS } = {}) {
  const containers = [];
  const notes = [];
  const listing = exec(['ps', '-a', '--filter', CONTAINER_NAME_FILTER, '--format', '{{.Names}}']);
  if (!succeeded(listing)) {
    notes.push(`docker ps unavailable: ${firstFailureLine(listing, limits)}`);
    return { containers, notes };
  }

  const names = [...new Set(String(listing.stdout ?? '').split('\n').map((name) => name.trim()).filter(Boolean))].sort();
  const selected = names.slice(0, limits.maxContainers);
  if (names.length > selected.length) {
    notes.push(`container list truncated: showing ${selected.length} of ${names.length}`);
  }

  for (const name of selected) {
    const cleanName = sanitizeField(name, limits.maxFieldChars);
    const inspected = exec(['inspect', '--format', INSPECT_TEMPLATE, name]);
    if (!succeeded(inspected)) {
      notes.push(`docker inspect failed for ${cleanName}: ${firstFailureLine(inspected, limits)}`);
      continue;
    }
    const parsed = parseInspect(inspected.stdout, limits);
    if (!parsed) {
      notes.push(`docker inspect returned no usable state for ${cleanName}`);
      continue;
    }
    containers.push(parsed);
  }

  return { containers, notes };
}

/** GET a health endpoint and keep only the status code. The response body is drained and dropped. */
export function httpProbe(url, { timeoutMs = DEFAULT_LIMITS.probeTimeoutMs } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (outcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };
    const request = http.get(url, { timeout: timeoutMs }, (response) => {
      response.resume();
      settle({ status: response.statusCode });
      response.on('error', () => {});
    });
    request.on('timeout', () => {
      request.destroy(Object.assign(new Error('probe timed out'), { code: 'ETIMEDOUT' }));
    });
    request.on('error', (error) => {
      settle({ error: sanitizeField(error?.code || 'error', 60) });
    });
  });
}

/** Probe the local API through Kong; each result is `HTTP <code>` or `no response (<code>)`. */
export async function collectProbeResults({ probe = httpProbe, urls = DEFAULT_PROBE_URLS } = {}) {
  return Promise.all(urls.map(async (url) => {
    try {
      const outcome = await probe(url);
      const status = Number(outcome?.status);
      if (Number.isInteger(status) && status >= 100 && status <= 599) return { url, result: `HTTP ${status}` };
      return { url, result: `no response (${sanitizeField(outcome?.error || 'error', 60)})` };
    } catch (error) {
      return { url, result: `no response (${sanitizeField(error?.code || error?.message || 'error', 60)})` };
    }
  }));
}

/** Render the bounded markdown report. The last line of defence: every value is sanitized here. */
export function renderReport({
  generatedAt = new Date().toISOString(),
  containers = [],
  probes = [],
  notes = [],
  limits = DEFAULT_LIMITS,
} = {}) {
  const lines = [
    '# CI database reset diagnostics',
    '',
    'Bounded, redacted snapshot captured because the database reset step failed. Container data is restricted to allow-listed Docker health/status/exit fields; API probes record status codes only. No environment variables, credentials, database rows, response bodies or container logs are collected.',
    '',
    `- Captured: ${sanitizeField(generatedAt, 64)}`,
    `- Container limit: ${limits.maxContainers}, each field truncated to ${limits.maxFieldChars} characters`,
    `- Report limit: ${limits.maxReportChars} characters`,
    '',
    '## Containers',
    '',
  ];

  if (containers.length === 0) {
    lines.push('_No Supabase containers were reported._', '');
  } else {
    lines.push(
      '| Container | State | Health | Exit | OOM | Restarts | Started | Finished |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
    );
    for (const container of containers.slice(0, limits.maxContainers)) {
      lines.push(
        `| ${cell(container.name, limits.maxFieldChars)} | ${cell(container.state, limits.maxFieldChars)}`
        + ` | ${cell(container.health, limits.maxFieldChars)} | ${cell(container.exitCode, 50)}`
        + ` | ${cell(container.oomKilled, 50)} | ${cell(container.restarts, 50)}`
        + ` | ${cell(container.startedAt, limits.maxFieldChars)} | ${cell(container.finishedAt, limits.maxFieldChars)} |`,
      );
    }
    lines.push('');
  }

  lines.push('## Local API probes', '', '| Target | Result |', '| --- | --- |');
  if (probes.length === 0) {
    lines.push('| (none probed) | unknown |');
  } else {
    for (const probe of probes) lines.push(`| ${cell(probe.url, 160)} | ${cell(probe.result, 60)} |`);
  }
  lines.push('');

  if (notes.length > 0) {
    lines.push('## Collection notes', '');
    for (const note of notes) lines.push(`- ${sanitizeField(note, limits.maxNoteChars)}`);
    lines.push('');
  }

  let report = lines.join('\n');
  if (report.length > limits.maxReportChars) {
    const cut = report.slice(0, limits.maxReportChars);
    const lastBreak = cut.lastIndexOf('\n');
    report = `${cut.slice(0, lastBreak > 0 ? lastBreak : cut.length)}\n\n_Truncated: diagnostics are bounded at ${limits.maxReportChars} characters._\n`;
  }
  return report;
}

/** Collect every diagnostic section. Injectable for isolated tests. */
export async function collectDiagnostics({ exec, probe, limits = DEFAULT_LIMITS, now = () => new Date().toISOString() } = {}) {
  const { containers, notes } = collectContainerDiagnostics({ exec, limits });
  const probes = await collectProbeResults({ probe });
  return { generatedAt: now(), containers, probes, notes, limits };
}

export async function main(argv = process.argv.slice(2)) {
  let out = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--out') {
      out = argv[index + 1];
      index += 1;
      if (!out) {
        process.stderr.write('ci-reset-diagnostics: --out requires a path\n');
        return 2;
      }
      continue;
    }
    process.stderr.write(`ci-reset-diagnostics: unknown argument ${sanitizeField(arg, 60)}\n`);
    return 2;
  }

  const report = renderReport(await collectDiagnostics());
  process.stdout.write(`${report}\n`);

  if (out) {
    try {
      mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
      writeFileSync(out, report);
    } catch (error) {
      process.stderr.write(`ci-reset-diagnostics: could not write ${sanitizeField(path.basename(out), 80)}: ${sanitizeField(error?.message || 'write failed', 160)}\n`);
    }
  }
  return 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      // Diagnostics are best-effort: an unexpected failure here must not mask the real one.
      process.stderr.write(`ci-reset-diagnostics: ${sanitizeField(error?.message || 'unexpected failure', 200)}\n`);
      process.exitCode = 0;
    },
  );
}
