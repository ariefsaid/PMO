#!/usr/bin/env node
/** Fail-closed lexical guard for edge-function redirects into the frontend router. */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { REDIRECT_TARGET_ALLOWLIST } from './redirect-target-allowlist.mjs';

const SCRIPT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;

const stripComments = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((line) => line.replace(/^\s*\/\/.*$/, '')).join('\n');

export function discoverFunctions(root) {
  const dir = join(root, 'supabase', 'functions');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, 'index.ts')))
    .map((entry) => ({ name: entry.name, file: join(dir, entry.name, 'index.ts') }));
}

export function extractRoutes(source) {
  const routes = new Set();
  for (const match of source.matchAll(/\bpath\s*(?::|=)\s*(['"`])([^'"`]+)\1/g)) {
    const path = match[2];
    if (path.startsWith('/') && path !== '*' && !path.includes('*')) routes.add(path);
  }
  return [...routes];
}

function imports(source) {
  const out = new Map();
  for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    for (const item of match[1].split(',')) {
      const [imported, local = imported] = item.trim().split(/\s+as\s+/);
      if (imported) out.set(local.trim(), { imported: imported.trim(), module: match[2] });
    }
  }
  return out;
}

function staticConstants(functionSource, functionFile) {
  const values = new Map();
  const imported = imports(functionSource);
  for (const [local, info] of imported) {
    // One hop only: inspect this module, and only a directly exported static string.
    if (!info.module.startsWith('.')) continue;
    const candidate = resolve(dirname(functionFile), info.module);
    const file = existsSync(candidate) ? candidate : `${candidate}.ts`;
    if (!existsSync(file)) continue;
    const moduleSource = stripComments(readFileSync(file, 'utf8'));
    const re = new RegExp(`export\\s+(?:const|let)\\s+${info.imported}\\s*=\\s*(['"])([^'"]+)\\1`);
    const match = moduleSource.match(re);
    if (match) values.set(local, match[2]);
  }
  return values;
}

function sinkExpressions(source) {
  const clean = stripComments(source);
  const found = [];
  const patterns = [
    /\bredirectTo\s*:\s*(`[^`]*`|'[^']*'|"[^"]*"|[^,}\n]+)/g,
    /\bResponse\.redirect\s*\(\s*(`[^`]*`|'[^']*'|"[^"]*"|[^,)\n]+)/g,
    /\bLocation\s*:\s*(`[^`]*`|'[^']*'|"[^"]*"|[^,}\n]+)/g,
    // Headers mutated imperatively rather than via an object literal. Without this,
    // `h.set("Location", "/x")` is SILENTLY unscanned — a guard that cannot see a whole
    // redirect form reports success it has not earned (#486 review finding, 2026-08-19).
    /\.(?:set|append)\s*\(\s*['"`][Ll]ocation['"`]\s*,\s*(`[^`]*`|'[^']*'|"[^"]*"|[^,)\n]+)/g,
  ];
  for (const pattern of patterns) for (const match of clean.matchAll(pattern)) {
    const expression = match[1].trim();
    if (!found.some((item) => item.expression === expression)) found.push({ expression });
  }
  return found;
}

function resolveExpression(expression, constants) {
  const literal = expression.match(/^(['"])(\/[^'"]*)\1$/);
  if (literal) return literal[2];
  if (/^`\/[^`$]*`$/.test(expression)) return expression.slice(1, -1);
  const template = expression.match(/^`\$\{[^}]+\}(\/[^`$]*)`$/);
  if (template) return template[1];
  if (constants.has(expression)) return constants.get(expression);
  return null;
}

export function normalizeTarget(target) {
  try { return new URL(target, 'https://redirect-target.invalid').pathname; } catch { return null; }
}

export function routeMatches(target, route) {
  const targetParts = normalizeTarget(target)?.split('/').filter(Boolean) ?? [];
  const routeParts = route.split('/').filter(Boolean);
  return targetParts.length === routeParts.length && targetParts.every((part, i) =>
    part.length > 0 && (routeParts[i].startsWith(':') || part === routeParts[i]),
  );
}

const finding = (message, extra = {}) => ({ message, ...extra });

export function auditRedirectTargets(root = SCRIPT_ROOT, allowlist = REDIRECT_TARGET_ALLOWLIST) {
  const functions = discoverFunctions(root);
  const findings = [];
  if (!functions.length) return [finding('no edge-function entrypoints discovered')];
  const app = join(root, 'pmo-portal', 'App.tsx');
  const routes = existsSync(app) ? extractRoutes(readFileSync(app, 'utf8')) : [];
  if (!routes.length) return [finding('no concrete frontend routes discovered from pmo-portal/App.tsx')];
  if (!Array.isArray(allowlist)) return [finding('redirect allowlist must be an array')];

  const candidates = [];
  for (const fn of functions) {
    const source = readFileSync(fn.file, 'utf8');
    const constants = staticConstants(source, fn.file);
    for (const item of sinkExpressions(source)) candidates.push({ ...item, function: fn.name, file: fn.file, target: resolveExpression(item.expression, constants) });
  }
  const used = new Set();
  for (const [index, entry] of allowlist.entries()) {
    if (!entry || [entry.function, entry.expression, entry.path, entry.reason].some((v) => typeof v !== 'string' || !v.trim())) {
      findings.push(finding(`stale/invalid allowlist entry at index ${index}: function, expression, path, and reason are required`)); continue;
    }
    const fnExists = functions.some((fn) => fn.name === entry.function);
    if (!fnExists) { findings.push(finding(`stale allowlist entry: function ${entry.function} no longer exists`)); continue; }
    if (!entry.path.startsWith('/') || !routes.some((route) => routeMatches(entry.path, route))) {
      findings.push(finding(`stale allowlist entry for ${entry.function}: route ${entry.path} no longer exists`)); continue;
    }
    const matches = candidates.filter((c) => c.function === entry.function && c.expression === entry.expression && c.target === null);
    if (matches.length !== 1) {
      findings.push(finding(`stale/ambiguous allowlist entry for ${entry.function}: ${entry.expression}`)); continue;
    }
    used.add(index);
  }
  for (const candidate of candidates) {
    if (candidate.target === null) {
      const matches = allowlist.map((entry, i) => ({ entry, i })).filter(({ entry, i }) => used.has(i) && entry.function === candidate.function && entry.expression === candidate.expression);
      if (!matches.length) findings.push(finding(`unresolved redirect in ${candidate.function}: ${candidate.expression}; add an allowlist entry with a reason`, candidate));
      else if (matches.length > 1) findings.push(finding(`ambiguous allowlist entries for ${candidate.function}: ${candidate.expression}; keep exactly one entry`, candidate));
      continue;
    }
    const path = normalizeTarget(candidate.target);
    if (!path || !routes.some((route) => routeMatches(path, route))) {
      findings.push(finding(`redirect in ${candidate.function} targets ${path ?? candidate.target}, which is not a concrete frontend route`, candidate));
    }
  }
  for (const [index, entry] of allowlist.entries()) if (!used.has(index) && !findings.some((f) => f.message.includes(`allowlist entry at index ${index}`))) {
    // Valid entries are consumed above; invalid entries already have their diagnostic.
    if (entry?.function && entry?.expression) findings.push(finding(`stale allowlist entry for ${entry.function}: ${entry.expression}`));
  }
  return findings;
}

function selfTest() {
  const root = mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'redirect-self-test-'));
  try {
    mkdirSync(join(root, 'pmo-portal'), { recursive: true }); mkdirSync(join(root, 'supabase/functions/good'), { recursive: true });
    writeFileSync(join(root, 'pmo-portal/App.tsx'), "{ path: '/safe', element: null }");
    writeFileSync(join(root, 'supabase/functions/good/index.ts'), "export const x = { redirectTo: '/safe' }");
    if (auditRedirectTargets(root).length) throw new Error('known-good fixture failed');
    writeFileSync(join(root, 'supabase/functions/good/index.ts'), "export const x = { redirectTo: '/missing' }");
    if (!auditRedirectTargets(root).length) throw new Error('known-bad fixture passed');
    // Imperative header mutation — the form the #486 review found silently unscanned.
    // Kept as a fixture so the blind spot cannot reopen.
    writeFileSync(join(root, 'supabase/functions/good/index.ts'), "const h = new Headers(); h.set('Location', '/missing');");
    if (!auditRedirectTargets(root).length) throw new Error('headers.set Location fixture passed');
    writeFileSync(join(root, 'supabase/functions/good/index.ts'), "const h = new Headers(); h.set('Location', '/safe');");
    if (auditRedirectTargets(root).length) throw new Error('headers.set Location good fixture failed');
    console.log('check-redirect-targets self-test OK: literal + imperative-header, good and bad fixtures');
  } finally { rmSync(root, { recursive: true, force: true }); }
}

if (isMain) {
  if (process.argv[2] === '--self-test') { try { selfTest(); } catch (error) { console.error(`✗ ${error.message}`); process.exit(1); } }
  else if (process.argv.length > 2) { console.error('usage: check-redirect-targets.mjs [--self-test]'); process.exit(2); }
  else {
    const findings = auditRedirectTargets();
    findings.forEach((item) => console.error(`✗ ${item.message}`));
    if (findings.length) process.exit(1);
    console.log('check-redirect-targets: OK');
  }
}
