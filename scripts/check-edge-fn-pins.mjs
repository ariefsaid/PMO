#!/usr/bin/env node
/**
 * check-edge-fn-pins.mjs — one command that reports every edge-function pin with its latest
 * version and its advisory status (#2320).
 *
 * Each Supabase edge function carries its own `deno.json` import map, and every package in it is
 * pinned exactly (npm:…) or (jsr:…). Nothing moves those pins: Dependabot covers `github-actions`
 * only, and `scripts/audit-prod.mjs` covers the npm trees the app ships. A pin therefore freezes
 * past a security fix the day it is written. This is the update path — the command the release
 * checklist runs, and the basis of the cadence recorded in `docs/runbooks/edge-fn-pins.md`.
 *
 * What it reports, per distinct package:
 *   - every import map that pins it, and the exact spec(s) it is pinned at;
 *   - the registry's latest published version (npm registry `/<pkg>/latest`, `jsr.io/<pkg>/meta.json`);
 *   - advisories from the npm registry's advisory feed (the source `npm audit` reads).
 *
 * What fails the command (a report that cannot fail is not a check):
 *   - a published advisory on a pinned version;
 *   - the same package pinned at two different versions (the pins must move together);
 *   - a pin we cannot verify — a registry/advisory-feed lookup that failed, a non-exact spec
 *     (`^1.2.3` describes a spec, not the version that shipped), an unversioned `npm:foo`, or an
 *     import this check does not understand. None of these is reported as clean.
 *
 * A pin behind latest is REPORTED but does not fail: being a release or two behind is ordinary,
 * and the cadence (not a per-PR gate) is what moves them. An advisory is different — it is a
 * known defect in code that runs — so it fails.
 *
 * Every lookup is retried 3 times with backoff (1s, 3s, 9s) before it counts as unverifiable: this
 * gate runs on the release PR, where one registry blip would otherwise red the whole run and spend
 * a CI cycle. A real outage still fails closed — after ~13s, naming the URL that failed and how
 * many attempts it survived.
 *
 * JSR: no advisory feed covers JSR packages (the GitHub Advisory DB / npm feed are npm-only). JSR
 * pins are reported as "not covered", which is not the same as clean, and the report says so.
 *
 * Usage:
 *   node scripts/check-edge-fn-pins.mjs            # scan supabase/functions
 *   PMO_FUNCTIONS_ROOT=<dir> node scripts/check-edge-fn-pins.mjs
 *
 * Exit code: 0 no blocking finding; 1 at least one (advisory, drift, or unverified pin).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

/** Where each registry's "latest published version" lives. */
export const LATEST_URL = {
  npm: (name) => `https://registry.npmjs.org/${name}/latest`,
  jsr: (name) => `https://jsr.io/${name}/meta.json`,
};

/** The npm registry's bulk advisory feed — the same source `npm audit` reads. npm-only. */
export const NPM_ADVISORY_URL = 'https://registry.npmjs.org/-/npm/v1/security/advisories/bulk';

export const ADVISORY_COVERAGE = {
  npm: 'npm registry advisory feed',
  jsr: 'none',
};

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SAFE_PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/i;
const REQUEST_TIMEOUT_MS = 15000;

/**
 * Backoff between attempts, per lookup. Three retries after the first attempt, so a single
 * registry/CDN blip cannot red the release run (this check runs on the release PR, where a flake
 * costs the whole run) — but a genuine outage still fails closed, naming the URL, after ~13s.
 * Every registry and advisory lookup goes through this.
 */
export const RETRY_DELAYS_MS = [1000, 3000, 9000];

/** The real backoff. Injected away in the tests so they never sleep. */
export const defaultWait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * parseImportSpecifier — classify one import-map VALUE.
 *   npm:@scope/pkg@1.2.3        -> {kind:'pin', registry, name, spec, subpath}
 *   jsr:@std/testing@1.0.0/bdd  -> {kind:'pin', …, subpath:'/bdd'}
 *   npm:pkg                     -> {kind:'pin', …, spec:null}   (unversioned — not a pin)
 *   ../../../pmo-portal/        -> {kind:'local'}               (the @/ path alias)
 *   anything else               -> {kind:'unsupported', value}  (reported, never skipped)
 */
export function parseImportSpecifier(value) {
  const raw = String(value ?? '');
  const match = /^(npm|jsr):(.+)$/.exec(raw);
  if (!match) {
    if (/^(?:\.{0,2}\/|~\/|\/)/.test(raw)) return { kind: 'local' };
    return { kind: 'unsupported', value: raw };
  }

  const registry = match[1];
  const rest = match[2];

  let name;
  let afterSpec;
  if (rest.startsWith('@')) {
    const slash = rest.indexOf('/');
    if (slash < 0) return { kind: 'unsupported', value: raw };
    const scope = rest.slice(0, slash);
    const tail = rest.slice(slash + 1);
    const at = tail.indexOf('@');
    if (at < 0) {
      name = `${scope}/${tail}`;
      afterSpec = null;
    } else {
      name = `${scope}/${tail.slice(0, at)}`;
      afterSpec = tail.slice(at + 1);
    }
  } else {
    const at = rest.indexOf('@');
    if (at < 0) {
      name = rest;
      afterSpec = null;
    } else {
      name = rest.slice(0, at);
      afterSpec = rest.slice(at + 1);
    }
  }

  if (!SAFE_PACKAGE_NAME.test(name)) return { kind: 'unsupported', value: raw };
  if (afterSpec == null) return { kind: 'pin', registry, name, spec: null, subpath: '' };

  const slash = afterSpec.indexOf('/');
  const spec = slash < 0 ? afterSpec : afterSpec.slice(0, slash);
  const subpath = slash < 0 ? '' : afterSpec.slice(slash);
  return { kind: 'pin', registry, name, spec: spec === '' ? null : spec, subpath };
}

/** The import map's own directory, relative to the functions root. */
function ownerOf(filePath) {
  const dir = path.dirname(filePath);
  return dir === '.' ? '.' : dir;
}

/**
 * collectPins — fold every import map into one row per distinct import.
 * Registry pins merge by `registry:name` (so @std/testing's /bdd and /mock exports are one
 * package, and a package pinned at two versions is ONE row carrying both specs — drift must not
 * hide behind two tidy rows). A local alias is dropped; an unclassifiable import is kept as an
 * `unsupported` row so it cannot silently disappear from the report.
 */
export function collectPins(files) {
  const rows = new Map();

  const upsert = (key, base, file, spec, subpath) => {
    const owner = ownerOf(file.path);
    const existing = rows.get(key);
    if (!existing) {
      rows.set(key, {
        ...base,
        key,
        owners: new Set([owner]),
        specs: new Set(spec ? [spec] : []),
        subpaths: new Set(subpath ? [subpath] : []),
      });
      return;
    }
    existing.owners.add(owner);
    if (spec) existing.specs.add(spec);
    if (subpath) existing.subpaths.add(subpath);
  };

  for (const file of files) {
    for (const [importName, value] of Object.entries(file.imports ?? {})) {
      const parsed = parseImportSpecifier(value);
      if (parsed.kind === 'local') continue;
      if (parsed.kind === 'unsupported') {
        upsert(`unsupported:${importName}`, { kind: 'unsupported', name: importName, value: parsed.value }, file, null, '');
        continue;
      }
      upsert(
        `${parsed.registry}:${parsed.name}`,
        { kind: 'pin', registry: parsed.registry, name: parsed.name },
        file,
        parsed.spec,
        parsed.subpath,
      );
    }
  }

  return [...rows.values()]
    .map((row) => ({
      ...row,
      owners: [...row.owners].sort(),
      specs: [...row.specs].sort(compareVersions),
      subpaths: [...row.subpaths].sort(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || String(a.registry).localeCompare(String(b.registry)));
}

/** Split `1.2.3-rc.1` into numeric parts and prerelease identifiers, or null when unparseable. */
function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(version ?? ''));
  if (!match) return null;
  return {
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] ? match[4].split('.') : [],
  };
}

/**
 * compareVersions — SemVer precedence for the shapes a registry publishes. Numeric parts compare
 * numerically (4.6.7 < 4.6.10), a prerelease sorts below its release, and prerelease identifiers
 * follow SemVer §11 (numeric below alphanumeric). Unparseable input sorts last.
 */
export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left && !right) return String(a).localeCompare(String(b));
  if (!left) return 1;
  if (!right) return -1;

  for (let i = 0; i < 3; i += 1) {
    if (left.parts[i] !== right.parts[i]) return left.parts[i] < right.parts[i] ? -1 : 1;
  }
  if (left.pre.length === 0 && right.pre.length === 0) return 0;
  if (left.pre.length === 0) return 1;
  if (right.pre.length === 0) return -1;

  const length = Math.max(left.pre.length, right.pre.length);
  for (let i = 0; i < length; i += 1) {
    const l = left.pre[i];
    const r = right.pre[i];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    const lNum = /^\d+$/.test(l);
    const rNum = /^\d+$/.test(r);
    if (lNum && rNum) {
      if (Number(l) !== Number(r)) return Number(l) < Number(r) ? -1 : 1;
    } else if (lNum !== rNum) {
      return lNum ? -1 : 1;
    } else if (l !== r) {
      return l < r ? -1 : 1;
    }
  }
  return 0;
}

/** True only when both versions parse and the pin is older than latest. */
export function isBehind(pinned, latest) {
  if (!parseVersion(pinned) || !parseVersion(latest)) return false;
  return compareVersions(pinned, latest) < 0;
}

/**
 * classifyPin — the verdict for one row. Blocking findings (they fail the command) are
 * `unsupported`, `advisory`, `drift`, `unverified`, `unpinned` and `range`; `behind` and
 * `current` are reported only.
 */
export function classifyPin({
  pin,
  latest = null,
  latestError = null,
  advisoryError = null,
  advisories = [],
  advisoryChecked = false,
}) {
  const base = {
    kind: pin.kind,
    key: pin.key,
    registry: pin.registry ?? null,
    name: pin.name,
    value: pin.value ?? null,
    specs: pin.specs ?? [],
    subpaths: pin.subpaths ?? [],
    owners: pin.owners ?? [],
    latest: latest ?? null,
    advisories,
    advisoryChecked,
    advisoryCoverage: pin.registry ? ADVISORY_COVERAGE[pin.registry] : 'none',
    pinned: (pin.specs ?? []).join(', ') || '—',
  };

  if (pin.kind === 'unsupported') {
    return {
      ...base,
      status: 'unsupported',
      blocking: true,
      detail: `import not understood by this check (${pin.value}) — pin it, alias it, or teach the check`,
    };
  }
  if (advisories.length > 0) {
    return {
      ...base,
      status: 'advisory',
      blocking: true,
      detail: `${advisories.length} published advisor${advisories.length === 1 ? 'y' : 'ies'} on ${base.pinned}`,
    };
  }
  if (base.specs.length > 1) {
    return {
      ...base,
      status: 'drift',
      blocking: true,
      detail: `pinned at ${base.specs.join(' and ')} in different import maps — the pins must move together`,
    };
  }
  if (base.specs.length === 0) {
    return {
      ...base,
      status: 'unpinned',
      blocking: true,
      detail: 'no version — an unversioned import resolves to whatever is latest at build time',
    };
  }
  if (!EXACT_VERSION.test(base.specs[0])) {
    return {
      ...base,
      status: 'range',
      blocking: true,
      detail: `"${base.specs[0]}" is a version spec, not a version — the advisory lookup can't describe what ships`,
    };
  }
  if (advisoryError) {
    return { ...base, status: 'unverified', blocking: true, detail: `could not verify advisories (${advisoryError})` };
  }
  if (latestError) {
    return { ...base, status: 'unverified', blocking: true, detail: `could not verify latest version (${latestError})` };
  }
  if (!latest) {
    return { ...base, status: 'unverified', blocking: true, detail: 'could not verify latest version (no answer)' };
  }
  if (!parseVersion(latest)) {
    return { ...base, status: 'unverified', blocking: true, detail: `registry answered an unparseable latest version ("${latest}")` };
  }
  if (isBehind(base.specs[0], latest)) {
    return { ...base, status: 'behind', blocking: false, detail: `behind latest ${latest}` };
  }
  return { ...base, status: 'current', blocking: false, detail: `current (${latest})` };
}

const STATUS_LABEL = {
  current: 'current',
  behind: 'BEHIND',
  advisory: 'ADVISORY',
  drift: 'DRIFT',
  unpinned: 'UNPINNED',
  range: 'RANGE',
  unverified: 'UNVERIFIED',
  unsupported: 'UNSUPPORTED',
};

function advisoryLine(row) {
  if (row.registry !== 'npm') return `advisory: not covered (no feed for JSR)`;
  if (row.advisories.length > 0) {
    return row.advisories
      .map((a) => `${a.id ?? 'advisory'}${a.severity ? ` [${a.severity}]` : ''} ${a.title ?? ''} ${a.url ?? ''}`.trim())
      .join('\n                   ');
  }
  // "none" is a claim about a lookup; only make it when one happened.
  if (!row.advisoryChecked) return 'advisory: not checked (the pin is not a single exact version)';
  return 'advisory: none';
}

function ownerLine(owners) {
  const shown = owners.slice(0, 3).join(', ');
  const more = owners.length > 3 ? ` (+${owners.length - 3} more)` : '';
  return `used by: ${owners.length} import map${owners.length === 1 ? '' : 's'} — ${shown}${more}`;
}

/** renderReport — the human report. One row per distinct import; nothing is omitted. */
export function renderReport({ rows, files, scannedRoot = 'supabase/functions' }) {
  const count = (status) => rows.filter((r) => r.status === status).length;
  const notCovered = rows.filter((r) => r.registry && ADVISORY_COVERAGE[r.registry] === 'none').length;
  const blocking = rows.filter((r) => r.blocking);

  const lines = [
    `Edge-function deno.json pins — ${files} import map${files === 1 ? '' : 's'} scanned under ${scannedRoot}`,
    '',
  ];

  for (const row of rows) {
    if (row.status === 'unsupported') {
      lines.push(`  ${STATUS_LABEL.unsupported}  ${row.name} -> ${row.value}`);
      lines.push(`      ${ownerLine(row.owners)}`);
      lines.push(`      ${row.detail}`);
      continue;
    }
    const pinned = row.specs.length > 1 ? row.specs.join(' + ') : row.pinned;
    lines.push(
      `  ${STATUS_LABEL[row.status] ?? row.status}  ${row.name}  ${row.registry}  pinned ${pinned}  latest ${row.latest ?? 'unknown'}`,
    );
    lines.push(`      ${ownerLine(row.owners)}`);
    if (row.subpaths.length > 0) lines.push(`      subpaths: ${row.subpaths.join(', ')}`);
    lines.push(`      ${advisoryLine(row)}`);
    if (row.status !== 'current') lines.push(`      ${row.detail}`);
  }

  lines.push('');
  lines.push(
    `entries: ${rows.length} · current ${count('current')} · behind ${count('behind')} · ` +
      `advisory ${count('advisory')} · drift ${count('drift')} · unverified ${count('unverified')} · ` +
      `unpinned ${count('unpinned')} · range ${count('range')} · unsupported ${count('unsupported')}`,
  );
  lines.push(
    'advisory coverage: npm pins against the npm registry advisory feed; ' +
      `${notCovered} jsr pin${notCovered === 1 ? ' is' : 's are'} not covered by any advisory feed ` +
      '("not covered" is not "clean").',
  );

  if (blocking.length > 0) {
    lines.push('');
    lines.push(`edge-fn pins: FAILED — ${blocking.length} blocking finding${blocking.length === 1 ? '' : 's'}.`);
    lines.push('Remediation and the bump cadence: docs/runbooks/edge-fn-pins.md');
  } else {
    lines.push('');
    lines.push("edge-fn pins: OK — no blocking finding: no advisory, no drift, every pin's latest version resolved.");
    if (count('behind') > 0) {
      lines.push(
        `${count('behind')} pin${count('behind') === 1 ? ' is' : 's are'} behind latest — report only; ` +
          'bumped together per docs/runbooks/edge-fn-pins.md',
      );
    }
  }

  return lines.join('\n');
}

/**
 * readImportMaps — every `deno.json` under `root` with its `imports` map. Sorted, so the report
 * is stable. A function that carries no imports map contributes `{}` (it is still scanned, so the
 * count in the report is the count on disk).
 */
export function readImportMaps(root) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name === 'deno.json') {
        const raw = fs.readFileSync(full, 'utf8');
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch (err) {
          throw new Error(`${path.relative(root, full)} is not valid JSON: ${err.message}`, { cause: err });
        }
        files.push({ path: path.relative(root, full), imports: parsed.imports ?? {} });
      }
    }
  };
  walk(root);
  return files;
}

/**
 * requestJson — one lookup with the shared retry policy. A network error, a non-2xx status and an
 * unreadable body are all retried; only after the retries are spent does it return an error, and
 * that error names the URL and the attempt count so the operator can tell a blip from an outage.
 */
async function requestJson(fetchImpl, url, init = {}, wait = defaultWait) {
  let reason = '';
  const attempts = RETRY_DELAYS_MS.length + 1;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (response.ok) return { json: await response.json() };
      reason = `HTTP ${response.status} from ${url}`;
    } catch (err) {
      reason = `${err instanceof Error ? err.message : String(err)} (${url})`;
    }
    const delay = RETRY_DELAYS_MS[attempt - 1];
    if (delay == null) break;
    await wait(delay);
  }
  return { error: `${reason} — gave up after ${attempts} attempts` };
}

async function fetchLatest(pin, fetchImpl, wait) {
  const url = LATEST_URL[pin.registry](pin.name);
  const { json, error } = await requestJson(fetchImpl, url, {}, wait);
  if (error) return { error };
  const latest = pin.registry === 'npm' ? json?.version : json?.latest;
  if (typeof latest !== 'string' || latest === '') return { error: `no version in the answer from ${url}` };
  return { latest };
}

/**
 * runCheck — resolve every pin, classify it, and render. `files`, `fetchImpl` and `wait` are
 * injected so the tests never touch the network and never sleep; `main` supplies the real ones.
 */
export async function runCheck({
  files,
  fetchImpl = fetch,
  wait = defaultWait,
  scannedRoot = 'supabase/functions',
}) {
  const pins = collectPins(files);

  const queried = pins.filter(
    (pin) => pin.kind === 'pin' && pin.specs.length === 1 && EXACT_VERSION.test(pin.specs[0]),
  );

  const latestByKey = new Map();
  await Promise.all(
    queried.map(async (pin) => {
      latestByKey.set(pin.key, await fetchLatest(pin, fetchImpl, wait));
    }),
  );

  // One request for the whole npm set — the bulk feed answers `{name: [advisory, …]}`.
  const npmQueried = queried.filter((pin) => pin.registry === 'npm');
  let advisoryByKey = new Map();
  let advisoryError = null;
  if (npmQueried.length > 0) {
    const body = Object.fromEntries(npmQueried.map((pin) => [pin.name, pin.specs]));
    const { json, error } = await requestJson(
      fetchImpl,
      NPM_ADVISORY_URL,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      wait,
    );
    if (error) {
      advisoryError = error;
    } else {
      advisoryByKey = new Map(
        npmQueried.map((pin) => [
          pin.key,
          Array.isArray(json?.[pin.name]) ? json[pin.name] : [],
        ]),
      );
    }
  }

  const rows = pins.map((pin) =>
    classifyPin({
      pin,
      latest: latestByKey.get(pin.key)?.latest ?? null,
      latestError: latestByKey.get(pin.key)?.error ?? null,
      advisoryError: pin.registry === 'npm' ? advisoryError : null,
      advisories: advisoryByKey.get(pin.key) ?? [],
      advisoryChecked: pin.registry === 'npm' && queried.includes(pin) && !advisoryError,
    }),
  );

  const ok = rows.every((row) => !row.blocking);
  return {
    ok,
    exitCode: ok ? 0 : 1,
    rows,
    files: files.length,
    report: renderReport({ rows, files: files.length, scannedRoot }),
  };
}

async function main() {
  const root = path.resolve(process.env.PMO_FUNCTIONS_ROOT ?? path.join(REPO, 'supabase', 'functions'));
  if (!fs.existsSync(root)) {
    console.error(`check-edge-fn-pins: no functions root at ${root} (set PMO_FUNCTIONS_ROOT)`);
    return 1;
  }
  const files = readImportMaps(root);
  if (files.length === 0) {
    console.error(`check-edge-fn-pins: found no deno.json under ${root} — refusing to report an empty set as clean`);
    return 1;
  }
  const scannedRoot = path.relative(REPO, root) || root;
  const result = await runCheck({ files, scannedRoot });
  console.log(result.report);
  return result.exitCode;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().then((code) => process.exit(code));
}
