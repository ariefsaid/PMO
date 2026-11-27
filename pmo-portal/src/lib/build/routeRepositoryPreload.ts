import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import type { Plugin } from 'vite';

function visit(node: ts.Node, callback: (node: ts.Node) => void): void {
  callback(node);
  ts.forEachChild(node, (child) => visit(child, callback));
}

function runtimeImport(node: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
  if (ts.isImportDeclaration(node)) {
    if (node.importClause?.isTypeOnly) return false;
    const bindings = node.importClause?.namedBindings;
    return !bindings || !ts.isNamedImports(bindings) || Boolean(node.importClause?.name) || bindings.elements.some((item) => !item.isTypeOnly);
  }
  return !node.isTypeOnly && (!node.exportClause || !ts.isNamedExports(node.exportClause) || node.exportClause.elements.some((item) => !item.isTypeOnly));
}

/** The runtime source graph, excluding other lazy destinations and type-only imports. */
export class RouteRepositoryGraph {
  private readonly options: ts.CompilerOptions;
  private readonly index: string;
  private readonly files = new Map<string, { imports: { file: string; names?: string[] }[]; domains: string[] }>();
  private readonly trees = new Map<string, ts.SourceFile>();
  private domains: Map<string, string> | undefined;

  constructor(readonly root: string) {
    this.index = path.join(root, 'src/lib/repositories/index.ts');
    const config = path.join(root, 'tsconfig.json');
    this.options = fs.existsSync(config)
      ? ts.parseJsonConfigFileContent(ts.readConfigFile(config, ts.sys.readFile).config, ts.sys, root).options
      : { moduleResolution: ts.ModuleResolutionKind.Bundler, baseUrl: root, paths: { '@/*': ['./*'] }, allowJs: true };
  }

  clear(): void { this.files.clear(); this.trees.clear(); this.domains = undefined; }

  resolve(specifier: string, importer: string): string | undefined {
    const file = ts.resolveModuleName(specifier, importer, this.options, ts.sys).resolvedModule?.resolvedFileName;
    return file && file.startsWith(this.root + path.sep) && !file.includes(path.sep + 'node_modules' + path.sep)
      && /\.[cm]?[jt]sx?$/.test(file) && !file.endsWith('.d.ts') ? path.normalize(file) : undefined;
  }

  private source(file: string): ts.SourceFile {
    let source = this.trees.get(file);
    if (!source) {
      source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      this.trees.set(file, source);
    }
    return source;
  }

  private domainModules(): Map<string, string> {
    if (this.domains) return this.domains;
    const result = new Map<string, string>();
    visit(this.source(this.index), (node) => {
      if (!ts.isVariableDeclaration(node) || node.name.getText() !== 'repositories' || !node.initializer || !ts.isObjectLiteralExpression(node.initializer)) return;
      for (const property of node.initializer.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        visit(property.initializer, (child) => {
          if (ts.isCallExpression(child) && child.expression.kind === ts.SyntaxKind.ImportKeyword && child.arguments[0] && ts.isStringLiteral(child.arguments[0])) {
            const file = this.resolve(child.arguments[0].text, this.index);
            if (file) result.set(property.name.getText().replaceAll(/['"]/g, ''), '/' + path.relative(this.root, file).split(path.sep).join('/'));
          }
        });
      }
    });
    this.domains = result;
    return result;
  }

  private read(file: string, wanted?: string[]): { imports: { file: string; names?: string[] }[]; domains: string[] } {
    const cacheKey = file + ':' + (wanted?.slice().sort().join(',') ?? '*');
    const cached = this.files.get(cacheKey);
    if (cached) return cached;
    const source = this.source(file);
    const imports: { file: string; names?: string[] }[] = [];
    const aliases = new Set<string>();
    for (const node of source.statements) {
      if (!(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) || !runtimeImport(node) || !node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) continue;
      let names: string[] | undefined;
      if (ts.isImportDeclaration(node)) {
        const clause = node.importClause;
        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          names = clause.namedBindings.elements.filter((item) => !item.isTypeOnly).map((item) => (item.propertyName ?? item.name).text);
          if (clause.name) names.push('default');
        } else if (clause?.name && !clause.namedBindings) names = ['default'];
      } else if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        const selected = node.exportClause.elements.filter((item) => !item.isTypeOnly && (!wanted || wanted.includes(item.name.text)));
        if (!selected.length) continue;
        names = selected.map((item) => (item.propertyName ?? item.name).text);
      } else names = wanted;
      const target = this.resolve(node.moduleSpecifier.text, file);
      if (target === this.index) {
        if (ts.isImportDeclaration(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
          for (const binding of node.importClause.namedBindings.elements) {
            if ((binding.propertyName ?? binding.name).text === 'repositories') aliases.add(binding.name.text);
          }
        }
      } else if (target) imports.push({ file: target, names });
    }
    const domains = new Set<string>();
    visit(source, (node) => {
      if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && aliases.has(node.expression.text)) domains.add(node.name.text);
      if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && aliases.has(node.expression.text)) {
        if (!ts.isStringLiteral(node.argumentExpression)) throw new Error('Name the repository domain used by ' + path.relative(this.root, file));
        domains.add(node.argumentExpression.text);
      }
    });
    const result = { imports, domains: [...domains] };
    this.files.set(cacheKey, result);
    return result;
  }

  modulesFor(file: string, shell = false): string[] {
    const pending: { file: string; names?: string[] }[] = shell ? [{ file }, { file: path.join(this.root, 'App.tsx') }] : [{ file }];
    const seen = new Set<string>();
    const modules = new Set<string>();
    while (pending.length) {
      const current = pending.pop()!;
      const key = current.file + ':' + (current.names?.slice().sort().join(',') ?? '*');
      if (seen.has(key) || current.file === this.index || !fs.existsSync(current.file)) continue;
      seen.add(key);
      const source = this.read(current.file, current.names);
      pending.push(...source.imports);
      for (const domain of source.domains) {
        const module = this.domainModules().get(domain);
        if (!module) throw new Error('No implementation module for repository ' + domain);
        modules.add(module);
      }
    }
    return [...modules].sort();
  }
}

/** Route/section code and its implementation modules download in the SAME wave. */
export function transformRouteImports(code: string, file: string, graph: RouteRepositoryGraph): string | null {
  if (file.includes('/src/lib/repositories/') || file.includes('/src/lib/build/')) return null;
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits: { from: number; to: number; code: string }[] = [];
  const loaders = new Map<string, number>();
  let prefix = '__pmoOwnedRepositories';
  while (code.includes(prefix)) prefix += '_';
  visit(source, (node) => {
    if (!ts.isCallExpression(node) || node.expression.kind !== ts.SyntaxKind.ImportKeyword || !node.arguments[0] || !ts.isStringLiteral(node.arguments[0])) return;
    const target = graph.resolve(node.arguments[0].text, file);
    if (!target || target.includes('/src/lib/repositories/')) return;
    const modules = graph.modulesFor(target, file === path.join(graph.root, 'App.tsx'));
    if (!modules.length) return;
    const indices = modules.map((module) => {
      if (!loaders.has(module)) loaders.set(module, loaders.size);
      return loaders.get(module)!;
    });
    edits.push({ from: node.getStart(source), to: node.getEnd(), code: 'Promise.all([' + node.getText(source) + ', ' + prefix + '(' + JSON.stringify(indices) + ')]).then(([module]) => module)' });
  });
  if (!edits.length) return null;
  for (const edit of edits.sort((a, b) => b.from - a.from)) code = code.slice(0, edit.from) + edit.code + code.slice(edit.to);
  // Each implementation import is emitted once per source module, even when many
  // routes share it. Repeating Vite's preload dependency arrays would inflate first load.
  const factories = [...loaders.keys()].map((module) => '() => import(' + JSON.stringify(module) + ')');
  return 'const ' + prefix + 'Loaders = [' + factories.join(',') + '];\n'
    + 'const ' + prefix + ' = (ids) => Promise.all(ids.map((id) => ' + prefix + 'Loaders[id]()));\n' + code;
}

export function routeRepositoryPreload(root: string): Plugin {
  const graph = new RouteRepositoryGraph(root);
  return {
    name: 'route-owned-repositories',
    enforce: 'pre',
    // Component fixtures exercise repositories separately; the production transform has its own contract tests.
    apply: (_config, environment) => environment.mode !== 'test',
    watchChange: () => graph.clear(),
    transform(code, id) {
      const file = id.split('?')[0];
      if (!file.startsWith(root + path.sep) || !/\.[cm]?[jt]sx?$/.test(file) || file.includes('/node_modules/')) return null;
      const result = transformRouteImports(code, file, graph);
      return result === null ? null : { code: result, map: null };
    },
  };
}
