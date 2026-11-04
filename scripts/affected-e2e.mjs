#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const root = process.cwd();
const app = path.join(root, 'pmo-portal');
const require = createRequire(path.join(app, 'package.json'));
const ts = require('typescript');

function source(file) {
  return ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}
function walk(node, visit) { visit(node); ts.forEachChild(node, child => walk(child, visit)); }
function resolveImport(from, spec) {
  const base = spec.startsWith('@/') ? path.join(app, spec.slice(2)) : path.resolve(path.dirname(from), spec);
  if (!spec.startsWith('.') && !spec.startsWith('@/')) return null;
  for (const candidate of [base, ...['.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts'].map(ext => base + ext)]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}
function imports(file) {
  const refs = [];
  walk(source(file), n => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) refs.push(n.moduleSpecifier.text);
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) refs.push(n.arguments[0].text);
  });
  return [...new Set(refs.map(ref => resolveImport(file, ref)).filter(Boolean))];
}
function appRoutes() {
  const file = path.join(app, 'App.tsx'), ast = source(file), moduleByName = new Map();
  walk(ast, n => {
    if (ts.isImportDeclaration(n) && n.importClause?.name && ts.isStringLiteral(n.moduleSpecifier)) {
      const resolved = resolveImport(file, n.moduleSpecifier.text); if (resolved) moduleByName.set(n.importClause.name.text, resolved);
    }
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) {
      const text = n.initializer?.getText(ast) ?? '';
      const match = text.match(/import\(['"]([^'"]+)['"]\)/);
      if (match) { const resolved = resolveImport(file, match[1]); if (resolved) moduleByName.set(n.name.text, resolved); }
    }
  });
  let config;
  walk(ast, n => { if (ts.isVariableDeclaration(n) && n.name.getText(ast) === 'appRouteConfig') config = n.initializer; });
  const routes = [];
  if (config && ts.isArrayLiteralExpression(config)) for (const entry of config.elements) {
    if (!ts.isObjectLiteralExpression(entry)) continue;
    const props = new Map(entry.properties.filter(ts.isPropertyAssignment).map(p => [p.name.getText(ast).replaceAll("'", ''), p.initializer]));
    const routePath = props.get('path'); if (!routePath || !ts.isStringLiteral(routePath)) continue;
    const roots = new Set();
    const elem = props.get('element'); if (elem) walk(elem, n => { if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) { const tag = n.tagName.getText(ast).split('.')[0]; if (moduleByName.has(tag)) roots.add(moduleByName.get(tag)); } });
    routes.push({ path: routePath.text, roots: [...roots] });
  }
  return { file, routes, shared: imports(file).filter(p => !p.includes(`${path.sep}pages${path.sep}`)) };
}
function closure(start) {
  const seen = new Set(), todo = [...start];
  while (todo.length) { const f = todo.pop(); if (seen.has(f)) continue; seen.add(f); todo.push(...imports(f)); }
  return seen;
}
function routeMatches(pattern, value) {
  const p = pattern.split('/').filter(Boolean), v = value.split('/').filter(Boolean);
  const common = Math.min(p.length, v.length);
  return common > 0 && p.slice(0, common).every((part, i) => part.startsWith(':') || part === '*' || v[i].startsWith(':') || part === v[i]);
}
function specs() {
  return fs.readdirSync(path.join(app, 'e2e'), { recursive: true })
    .filter(name => name.endsWith('.spec.ts') && !/AC-CON-(003|012)-|AC-VISUAL-CHECKBOX-001-/.test(name))
    .map(name => path.join(app, 'e2e', name));
}
function specFiles(file, seen = new Set()) {
  if (seen.has(file)) return seen;
  seen.add(file);
  for (const ref of imports(file)) {
    if (ref.startsWith(path.join(app, 'e2e') + path.sep)) specFiles(ref, seen);
  }
  return seen;
}
function literalText(node, constants = new Map()) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map(span => span.literal.text).join('');
  if (ts.isParenthesizedExpression(node)) return literalText(node.expression, constants);
  if (ts.isIdentifier(node)) return constants.has(node.text) ? constants.get(node.text) : '';
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) return literalText(node.left, constants) + literalText(node.right, constants);
  return '';
}
function specRoutes(file, routes) {
  const visited = [], files = specFiles(file);
  for (const sourceFile of files) {
    const ast = source(sourceFile);
    const constants = new Map();
    walk(ast, n => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
        const value = literalText(n.initializer, constants);
        if (value) constants.set(n.name.text, value);
      }
    });
    walk(ast, n => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
        const method = n.expression.name.text;
        if (method === 'goto' && n.arguments[0]) {
          const raw = literalText(n.arguments[0], constants);
          try { if (raw) visited.push(new URL(raw.replace(/\$\{[^}]*\}/g, 'fixture'), 'http://local').pathname); } catch { /* Ignore malformed navigation values. */ }
        }
      }
      // Layout route entries are meaningful only at the registration site; arbitrary `path`
      // properties in a spec (API fixtures, data, etc.) are not browser navigation.
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'registerLayoutSweep' && n.arguments[0] && ts.isObjectLiteralExpression(n.arguments[0])) {
        const route = n.arguments[0].properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(ast) === 'path');
        if (route && ts.isPropertyAssignment(route)) {
          const raw = literalText(route.initializer, constants);
          if (raw.startsWith('/')) visited.push(raw);
        }
      }
    });
    // A click only establishes navigation when its test also asserts the resulting URL.
    // Merely querying a rail link (which is rendered on most pages) has no routing weight.
    walk(ast, n => {
      if (!ts.isCallExpression(n) || !ts.isIdentifier(n.expression) || !['test', 'it'].includes(n.expression.text)) return;
      const callback = n.arguments.find(arg => ts.isArrowFunction(arg) || ts.isFunctionExpression(arg));
      if (!callback || !callback.body.getText(ast).includes('.click(')) return;
      const calls = [];
      walk(callback.body, child => {
        if (ts.isCallExpression(child) && ts.isPropertyAccessExpression(child.expression) && child.expression.name.text === 'toHaveURL' && child.arguments[0]) calls.push(child.arguments[0]);
      });
      for (const assertion of calls) {
        let urlPattern = '';
        if (ts.isRegularExpressionLiteral(assertion)) urlPattern = assertion.text.slice(1, assertion.text.lastIndexOf('/'));
        else urlPattern = literalText(assertion, constants);
        if (!urlPattern) continue;
        for (const route of routes) {
          const segments = route.path.split('/').filter(Boolean).filter(segment => !segment.startsWith(':'));
          if (segments.length && segments.every(segment => urlPattern.includes(segment))) visited.push(route.path);
        }
      }
    });
  }
  return [...new Set(visited)];
}
function select(changed, routeData, allSpecs) {
  const routes = routeData.routes;
  const routeDeps = routes.map(route => ({ ...route, deps: closure([...route.roots, ...routeData.shared]) }));
  const routeHits = new Set();
  for (const file of changed) {
    const abs = path.resolve(root, file);
    if (/\/public\/locales\//.test(abs)) { routeDeps.forEach((_, i) => routeHits.add(i)); continue; }
    routeDeps.forEach((route, i) => { if (route.deps.has(abs)) routeHits.add(i); });
  }
  const paths = [...routeHits].map(i => routeDeps[i].path);
  return allSpecs.filter(file => {
    const visited = specRoutes(file, routes);
    return paths.some(changedPath => visited.some(visit => routeMatches(changedPath, visit)));
  }).sort();
}
function selfTest() {
  const allSpecs = specs(), routeData = appRoutes();
  const companies = select(['pmo-portal/pages/Companies.tsx'], routeData, allSpecs).map(f => path.relative(app, f));
  const expected = [
    'e2e/AC-IMP-011-bulk-import-journey.spec.ts', 'e2e/AC-CO-001-companies-crud.spec.ts',
    'e2e/AC-LRC-006-companies-return.spec.ts', 'e2e/layout/companies.layout.spec.ts',
    'e2e/AC-A11Y-MODAL-001-focus-containment.spec.ts', 'e2e/serial/AC-LRC-013-locale-phone-return.spec.ts',
    'e2e/serial/AC-CODE-002-project-number-proposal.spec.ts',
  ];
  if (expected.some(file => !companies.includes(file))) throw new Error(`affected-e2e Companies recall self-test failed: missing ${expected.filter(file => !companies.includes(file)).join(', ')}`);
  if (companies.length > 15) throw new Error(`affected-e2e Companies precision self-test failed: selected ${companies.length} specs (maximum 15)`);

  const shell = select(['pmo-portal/src/components/shell/index.ts'], routeData, allSpecs);
  if (shell.length <= 100) throw new Error(`affected-e2e shared-shell self-test failed: selected ${shell.length} specs (expected more than 100)`);

  // This fixture's route is reachable only through an imported helper function.
  const fixtureDir = path.join(app, 'e2e', `affected-e2e-fixture-${process.pid}`);
  const helper = path.join(fixtureDir, 'navigation.ts'), fixture = path.join(fixtureDir, 'helper-only.spec.ts'), page = path.join(fixtureDir, 'Projects.tsx');
  let helperSelection;
  try {
    fs.mkdirSync(fixtureDir, { recursive: true });
    fs.writeFileSync(helper, "export async function openProjects(page) { await page.goto('/projects'); }\n");
    fs.writeFileSync(fixture, "import { openProjects } from './navigation';\nvoid openProjects;\n");
    fs.writeFileSync(page, 'export default function Projects() { return null; }\n');
    helperSelection = select([path.relative(root, page)], { routes: [{ path: '/projects', roots: [page] }], shared: [] }, [fixture]).map(f => path.relative(app, f));
    if (helperSelection.length !== 1 || helperSelection[0] !== 'e2e/affected-e2e-fixture-' + process.pid + '/helper-only.spec.ts') throw new Error('affected-e2e helper-route self-test failed');
  } finally { fs.rmSync(fixtureDir, { recursive: true, force: true }); }
  console.log(`Fixture 1 (Companies diff): selected ${companies.length} of ${allSpecs.length} specs`);
  console.log(`Required selections: ${expected.join(', ')}`);
  console.log(`Fixture 2 (helper-only navigation): selected ${helperSelection.length} of 1 fixture spec (${path.relative(app, fixture)})`);
  console.log(`Fixture 3 (shared shell diff): selected ${shell.length} of ${allSpecs.length} specs`);
  console.log('affected-e2e self-test passed');
}
function gitChanged(base) {
  const names = new Set();
  for (const args of [['diff', '--name-only', `${base}...HEAD`], ['diff', '--name-only'], ['diff', '--cached', '--name-only']]) {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`);
    result.stdout.split(/\r?\n/).filter(Boolean).forEach(n => names.add(n));
  }
  return [...names];
}
const args = process.argv.slice(2);
if (args.includes('--self-test')) selfTest();
else {
  const baseAt = args.indexOf('--base'), base = baseAt >= 0 ? args[baseAt + 1] : 'origin/dev';
  const changed = gitChanged(base).filter(f => /^(pmo-portal\/(pages|src\/(components|hooks|lib\/repositories))\/|pmo-portal\/public\/locales\/)/.test(f));
  if (!changed.length) { console.log('No supported UI paths changed.'); process.exit(0); }
  const selected = select(changed, appRoutes(), specs());
  const files = selected.map(f => path.relative(app, f));
  console.log(files.length ? files.join('\n') : '(no matching e2e specs)');
  console.log(`Selected ${files.length} of ${specs().length} specs.`);
  const command = `scripts/e2e-local.sh --project=chromium --project=serial ${files.join(' ')}`;
  console.log(`\nRun command: ${command}`);
  if (args.includes('--run') && files.length) {
    const result = spawnSync(path.join(root, 'scripts/e2e-local.sh'), ['--project=chromium', '--project=serial', ...files], { cwd: root, stdio: 'inherit' });
    process.exit(result.status ?? 1);
  }
}
