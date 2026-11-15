import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { deriveProjects } from './tsconfigProjects.mjs';

/**
 * `npm run typecheck` builds four projects instead of one large program (#2317):
 * tsconfig.app.json (what index.tsx reaches, composite), tsconfig.server.json (the rest of the
 * non-test code, composite) and two leaves that read both through their declarations,
 * tsconfig.test.json (unit tests) and tsconfig.tooling.json (e2e, evals, build/lint configs).
 * These tests pin the split to the single-program config it replaced: every file tsconfig.json
 * checks is still checked, with the same compiler options, and the generated file lists match
 * what the imports say.
 */

const ROOT = path.resolve(__dirname, '..');
const REGENERATE = 'run `node test/tsconfigProjects.mjs --write` in pmo-portal';

function parse(name: string): ts.ParsedCommandLine {
  const parsed = ts.getParsedCommandLineOfConfigFile(path.join(ROOT, name), {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => {
      throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n'));
    },
  });
  if (!parsed) throw new Error(`could not parse ${name}`);
  expect(parsed.errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([]);
  return parsed;
}

const rawFiles = (name: string): string[] =>
  (ts.readConfigFile(path.join(ROOT, name), ts.sys.readFile).config.files as string[]) ?? [];

const full = parse('tsconfig.json');
const app = parse('tsconfig.app.json');
const server = parse('tsconfig.server.json');
const unit = parse('tsconfig.test.json');
const tooling = parse('tsconfig.tooling.json');
const derived = deriveProjects();

const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join('/');
const inNodeModules = (f: string) => f.split(/[\\/]/).includes('node_modules');
const isAmbient = (f: string) => /\.d\.[cm]?ts$/.test(f);
const isJson = (f: string) => f.endsWith('.json');
const appFiles = new Set(app.fileNames);
const serverFiles = new Set(server.fileNames);
const composite = (f: string) => appFiles.has(f) || serverFiles.has(f);
const unitFiles = new Set(unit.fileNames.filter((f) => !composite(f)));
const toolingFiles = new Set(tooling.fileNames.filter((f) => !composite(f)));

/** `{ add, remove }` turning `actual` into `expected`; both empty when they agree. */
function drift(actual: Iterable<string>, expected: Iterable<string>) {
  const a = new Set(actual);
  const e = new Set(expected);
  return {
    add: [...e].filter((f) => !a.has(f)).sort(),
    remove: [...a].filter((f) => !e.has(f)).sort(),
  };
}
const NONE = { add: [], remove: [] };

// Options that only steer where a project writes its build output.
const BUILD_ONLY = new Set([
  'composite', 'declaration', 'declarationDir', 'emitDeclarationOnly', 'incremental', 'noEmit',
  'outDir', 'rootDir', 'tsBuildInfoFile', 'configFilePath', 'pathsBasePath',
]);
const checkingOptions = (o: ts.CompilerOptions) =>
  Object.fromEntries(Object.entries(o).filter(([k]) => !BUILD_ONLY.has(k)));

describe('typecheck project split (#2317)', () => {
  it('checks every file tsconfig.json checks', () => {
    const unowned = full.fileNames.filter((f) => !composite(f) && !unitFiles.has(f) && !toolingFiles.has(f));
    expect(unowned.map(rel)).toEqual([]);
  });

  it('gives each file exactly one owner (ambient .d.ts files aside)', () => {
    expect([...appFiles].filter((f) => serverFiles.has(f) && !isAmbient(f)).map(rel)).toEqual([]);
    expect([...unitFiles].filter((f) => toolingFiles.has(f)).map(rel)).toEqual([]);
  });

  it('puts in the app project exactly the code index.tsx reaches', () => {
    const code = (fs: Iterable<string>) => [...fs].filter((f) => !isJson(f) && !isAmbient(f)).map(rel);
    expect(drift(code(app.fileNames), code(derived.appReached)), `app project drifted: ${REGENERATE}`).toEqual(NONE);
  });

  it('puts every other non-test file in the server project', () => {
    const inTree = server.fileNames.filter((f) => !isAmbient(f) && !rel(f).startsWith('../')).map(rel);
    expect(drift(inTree, [...derived.serverInTree].map(rel)), `server project drifted: ${REGENERATE}`).toEqual(NONE);
  });

  it('lists exactly the files each composite project compiles from outside its include', () => {
    expect(drift(rawFiles('tsconfig.app.json'), derived.appFiles), `tsconfig.app.json files: ${REGENERATE}`)
      .toEqual(NONE);
    expect(drift(rawFiles('tsconfig.server.json'), derived.serverFiles), `tsconfig.server.json files: ${REGENERATE}`)
      .toEqual(NONE);
  });

  it('excludes from the app project exactly the test side and the server files', () => {
    const exclude = ts.readConfigFile(path.join(ROOT, 'tsconfig.app.json'), ts.sys.readFile).config.exclude as string[];
    expect(exclude, `tsconfig.app.json exclude: ${REGENERATE}`).toEqual(derived.appExclude);
  });

  it('keeps every tooling file out of the composite projects', () => {
    const shared = tooling.fileNames.filter((f) => !inNodeModules(f) && !isAmbient(f) && composite(f));
    expect(shared.map(rel)).toEqual([]);
  });

  it('keeps production code in the composite projects and tests out of them', () => {
    expect([...appFiles].map(rel)).toEqual(expect.arrayContaining(['App.tsx', 'src/lib/db/timesheetPush.ts']));
    expect([...serverFiles].map(rel)).toContain('src/lib/adapterSeam/dispatch.ts');
    const compositeRel = [...appFiles, ...serverFiles].map(rel);
    expect(compositeRel.filter((f) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f))).toEqual([]);
    expect([...unitFiles].map(rel)).toContain('src/lib/db/timesheetPushReadModels.test.ts');
    expect([...toolingFiles].map(rel)).toContain('playwright.config.ts');
  });

  it('checks every project with the same compiler options as tsconfig.json', () => {
    const expected = checkingOptions(full.options);
    expect(expected.strict).toBe(true);
    for (const p of [app, server, unit, tooling]) expect(checkingOptions(p.options)).toEqual(expected);
  });

  it('builds app, then server on it, as composite projects both leaves reference', () => {
    expect(app.options.composite).toBe(true);
    expect(server.options.composite).toBe(true);
    const refs = (p: ts.ParsedCommandLine) => (p.projectReferences ?? []).map((r) => path.basename(r.path));
    expect(refs(app)).toEqual([]);
    expect(refs(server)).toEqual(['tsconfig.app.json']);
    expect(refs(unit)).toEqual(['tsconfig.app.json', 'tsconfig.server.json']);
    expect(refs(tooling)).toEqual(['tsconfig.app.json', 'tsconfig.server.json']);
  });
});
