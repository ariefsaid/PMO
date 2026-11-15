import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * `npm run typecheck` builds three projects instead of one large program (#2317):
 * tsconfig.app.json (production code, composite) and two leaves that read its declarations,
 * tsconfig.test.json (unit tests) and tsconfig.tooling.json (e2e, evals, build/lint configs).
 * These tests pin the split to the single-program config it replaced: every file tsconfig.json
 * checks is still checked by exactly one project, with the same compiler options.
 */

const ROOT = path.resolve(__dirname, '..');

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

const full = parse('tsconfig.json');
const app = parse('tsconfig.app.json');
const unit = parse('tsconfig.test.json');
const tooling = parse('tsconfig.tooling.json');

const appFiles = new Set(app.fileNames);
const outsideApp = (f: string) => path.relative(ROOT, f).startsWith('..');
const inNodeModules = (f: string) => f.split(/[\\/]/).includes('node_modules');

/** Files outside pmo-portal that production code reaches through its imports, transitively. */
function outOfTreeImports(): Set<string> {
  const host = { ...ts.sys };
  const cache = ts.createModuleResolutionCache(ROOT, (f) => f, app.options);
  const seen = new Set<string>();
  const found = new Set<string>();
  const queue = app.fileNames.filter((f) => !f.endsWith('.json'));
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = ts.sys.readFile(file);
    if (text === undefined) continue;
    for (const ref of ts.preProcessFile(text, true, true).importedFiles) {
      const resolved = ts.resolveModuleName(ref.fileName, file, app.options, host, cache).resolvedModule;
      if (!resolved || resolved.isExternalLibraryImport || inNodeModules(resolved.resolvedFileName)) continue;
      const target = path.resolve(resolved.resolvedFileName);
      if (outsideApp(target)) found.add(target);
      if (!target.endsWith('.json')) queue.push(target);
    }
  }
  return found;
}

function listedOutOfTreeFiles(): Set<string> {
  const { config } = ts.readConfigFile(path.join(ROOT, 'tsconfig.app.json'), ts.sys.readFile);
  return new Set((config.files as string[]).map((f) => path.resolve(ROOT, f)));
}
const unitFiles = new Set(unit.fileNames.filter((f) => !appFiles.has(f)));
const toolingFiles = new Set(tooling.fileNames.filter((f) => !appFiles.has(f)));

// Options that only steer where a project writes its build output.
const BUILD_ONLY = new Set([
  'composite', 'declaration', 'declarationDir', 'emitDeclarationOnly', 'incremental', 'noEmit',
  'outDir', 'rootDir', 'tsBuildInfoFile', 'configFilePath', 'pathsBasePath',
]);
const checkingOptions = (o: ts.CompilerOptions) =>
  Object.fromEntries(Object.entries(o).filter(([k]) => !BUILD_ONLY.has(k)));

describe('typecheck project split (#2317)', () => {
  it('checks every file tsconfig.json checks', () => {
    const unowned = full.fileNames.filter(
      (f) => !appFiles.has(f) && !unitFiles.has(f) && !toolingFiles.has(f),
    );
    expect(unowned).toEqual([]);
  });

  it('gives each file outside the app project exactly one owner', () => {
    expect([...unitFiles].filter((f) => toolingFiles.has(f))).toEqual([]);
  });

  it("lists in tsconfig.app.json `files` exactly the files outside pmo-portal that production code imports", () => {
    const imported = outOfTreeImports();
    const listed = listedOutOfTreeFiles();
    const rel = (f: string) => path.relative(ROOT, f);
    const add = [...imported].filter((f) => !listed.has(f)).map(rel).sort();
    const remove = [...listed].filter((f) => !imported.has(f)).map(rel).sort();
    expect({ add, remove }, 'update tsconfig.app.json `files`').toEqual({ add: [], remove: [] });
  });

  it('keeps every tooling file out of the app project', () => {
    const shared = tooling.fileNames.filter((f) => !inNodeModules(f) && appFiles.has(f)).map((f) => path.relative(ROOT, f));
    expect(shared).toEqual([]);
  });

  it('keeps production code in the app project and tests out of it', () => {
    const rel = (f: string) => path.relative(ROOT, f);
    const appRel = [...appFiles].map(rel);
    expect(appRel).toContain('App.tsx');
    expect(appRel).toContain('src/lib/db/timesheetPush.ts');
    expect(appRel.filter((f) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f))).toEqual([]);
    expect([...unitFiles].map(rel)).toContain('src/lib/db/timesheetPushReadModels.test.ts');
    expect([...toolingFiles].map(rel)).toContain('playwright.config.ts');
  });

  it('checks every project with the same compiler options as tsconfig.json', () => {
    const expected = checkingOptions(full.options);
    expect(expected.strict).toBe(true);
    expect(checkingOptions(app.options)).toEqual(expected);
    expect(checkingOptions(unit.options)).toEqual(expected);
    expect(checkingOptions(tooling.options)).toEqual(expected);
  });

  it('builds the app as a composite project the two leaves reference', () => {
    expect(app.options.composite).toBe(true);
    const refs = (p: ts.ParsedCommandLine) => (p.projectReferences ?? []).map((r) => path.basename(r.path));
    expect(refs(unit)).toEqual(['tsconfig.app.json']);
    expect(refs(tooling)).toEqual(['tsconfig.app.json']);
  });
});
