// Derives the generated file lists of tsconfig.app.json and tsconfig.server.json (#2317).
//
// The app project is everything the browser entry (index.tsx) reaches through its imports; the
// server project is the rest of the non-test code (adapter seams run by edge functions, build
// helpers, modules nothing imports yet). Both lists come from walking imports, so they never
// need hand edits: `node test/tsconfigProjects.mjs --write` rewrites them, and
// test/tsconfigProjects.test.ts fails when they drift.
//
// Hand-written: TEST_SIDE below (what counts as test code) and every compiler option. Generated:
// tsconfig.app.json `files` (files outside pmo-portal the app imports) and `exclude` (BASE_EXCLUDE,
// TEST_SIDE, then the server files), and tsconfig.server.json `files`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ENTRIES = ['index.tsx'];
export const BASE_EXCLUDE = ["coverage", "dist", "dist-consent", "node_modules"];
/** Tests, fixtures and tooling: kept out of both composite projects; tsconfig.test.json and tsconfig.tooling.json check them. */
export const TEST_SIDE = [
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.test.mjs",
  "**/*.spec.ts",
  "**/__tests__/**",
  "e2e/**",
  "test/**",
  "evals/**",
  "src/test/**",
  "**/*.harness.ts",
  "**/*.test-helpers.tsx",
  "**/*.fake.ts",
  "**/fake*.ts",
  "**/*Fixtures.ts",
  "**/__fixtures__/**",
  "**/testing/**",
  "**/*-proof.mjs",
  "src/lib/agent/dispatch/dispatcherTestRpc.ts",
  "src/lib/agent/runtime/runtime.contract.ts",
  "src/components/documents/testkit.tsx",
  "src/lib/adapterSeam/contractSuite/**",
  "playwright.config.ts",
  "vitest.eval.config.ts",
  "vite.config.ts",
  "eslint.config.js",
];
const APP_CONFIG = path.join(ROOT, 'tsconfig.app.json');
const SERVER_CONFIG = path.join(ROOT, 'tsconfig.server.json');


const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');
const abs = (f) => path.resolve(ROOT, f);
const isOutside = (f) => rel(f).startsWith('../');
const inNodeModules = (f) => f.split(/[\\/]/).includes('node_modules');
const isJson = (f) => f.endsWith('.json');
const isAmbient = (f) => /\.d\.[cm]?ts$/.test(f);

function readRaw(file) {
  const { config, error } = ts.readConfigFile(file, ts.sys.readFile);
  if (error) throw new Error(ts.flattenDiagnosticMessageText(error.messageText, '\n'));
  return config;
}

/** Every non-node_modules file reached from `roots` through imports, transitively. */
function reach(roots, options) {
  const cache = ts.createModuleResolutionCache(ROOT, (f) => f, options);
  const seen = new Set();
  const queue = [...roots];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (isJson(file)) continue;
    const text = ts.sys.readFile(file);
    if (text === undefined) continue;
    for (const ref of ts.preProcessFile(text, true, true).importedFiles) {
      const resolved = ts.resolveModuleName(ref.fileName, file, options, ts.sys, cache).resolvedModule;
      if (!resolved || resolved.isExternalLibraryImport || inNodeModules(resolved.resolvedFileName)) continue;
      queue.push(path.resolve(resolved.resolvedFileName));
    }
  }
  return seen;
}

/**
 * @returns {{ appFiles: string[], appExclude: string[], serverFiles: string[],
 *   appReached: Set<string>, serverInTree: Set<string>, ambient: string[] }}
 * Paths in the arrays are relative to pmo-portal, sorted, as they appear in the configs.
 */
export function deriveProjects() {
  const appRaw = readRaw(APP_CONFIG);
  const parsed = ts.parseJsonConfigFileContent(
    { ...appRaw, files: undefined, exclude: [...BASE_EXCLUDE, ...TEST_SIDE], references: undefined },
    ts.sys,
    ROOT,
    undefined,
    APP_CONFIG,
  );
  const candidates = parsed.fileNames.filter((f) => !isJson(f));
  const ambient = candidates.filter(isAmbient);

  const appReached = reach([...ENTRIES.map(abs), ...ambient], parsed.options);
  const serverInTree = new Set(candidates.filter((f) => !appReached.has(f) && !isAmbient(f)));
  const serverReached = reach([...serverInTree], parsed.options);

  const candidateSet = new Set(candidates);
  const stray = [...serverReached].filter(
    (f) => !isOutside(f) && !isJson(f) && !candidateSet.has(f) && !appReached.has(f),
  );
  if (stray.length) {
    throw new Error(`server code imports test-side files (move them out of the test patterns): ${stray.map(rel).join(', ')}`);
  }

  const appOutside = [...appReached].filter(isOutside);
  const appOutsideSet = new Set(appOutside);
  const serverOutside = [...serverReached].filter((f) => isOutside(f) && !appOutsideSet.has(f));
  const sorted = (xs) => [...new Set(xs.map(rel))].sort();
  const serverExclude = sorted([...serverInTree]);
  return {
    appFiles: sorted(appOutside),
    appExclude: [...BASE_EXCLUDE, ...TEST_SIDE, ...serverExclude],
    serverFiles: sorted([...ambient, ...serverInTree, ...serverOutside]),
    appReached,
    serverInTree,
    ambient: sorted(ambient),
  };
}

/** Rewrites one JSONC config, keeping its leading `//` comment block. */
function rewrite(file, update) {
  const text = fs.readFileSync(file, 'utf8');
  const header = text.match(/^(?:\/\/.*\n)*/)[0];
  const next = update(readRaw(file));
  fs.writeFileSync(file, header + JSON.stringify(next, null, 2) + '\n');
}

export function writeProjects() {
  const derived = deriveProjects();
  rewrite(APP_CONFIG, (c) => ({ ...c, files: derived.appFiles, exclude: derived.appExclude }));
  rewrite(SERVER_CONFIG, (c) => ({ ...c, files: derived.serverFiles }));
  return derived;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv.includes('--write')) {
    console.error('usage: node test/tsconfigProjects.mjs --write');
    process.exit(2);
  }
  const d = writeProjects();
  console.log(`tsconfig.app.json files: ${d.appFiles.length}; tsconfig.server.json files: ${d.serverFiles.length}`);
}
