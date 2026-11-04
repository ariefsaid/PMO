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
  let base = spec.startsWith('@/') ? path.join(app, spec.slice(2)) : path.resolve(path.dirname(from), spec);
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
  if (p.length !== v.length) return false;
  return p.every((part, i) => part.startsWith(':') || part === '*' || part === v[i]);
}
function routeForLink(label, routes) {
  const normalized = label.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!normalized) return [];
  return routes.filter(({ path: route }) => {
    const segments = route.split('/').filter(s => s && !s.startsWith(':'));
    return segments.some(segment => normalized.includes(segment.toLowerCase())) || normalized === route.split('/').filter(Boolean).at(-1)?.toLowerCase();
  }).map(r => r.path);
}
function specs() {
  return fs.readdirSync(path.join(app, 'e2e'), { recursive: true })
    .filter(name => name.endsWith('.spec.ts') && !/AC-CON-(003|012)-|AC-VISUAL-CHECKBOX-001-/.test(name))
    .map(name => path.join(app, 'e2e', name));
}
function specRoutes(file, routes) {
  const text = fs.readFileSync(file, 'utf8'), visited = [];
  for (const match of text.matchAll(/\.goto\(\s*([`'"])(.*?)\1/g)) {
    const raw = match[2].replace(/\$\{[^}]*\}/g, 'fixture');
    try { visited.push(new URL(raw, 'http://local').pathname); } catch {}
  }
  for (const match of text.matchAll(/getByRole\(\s*['"]link['"]\s*,\s*\{\s*name\s*:\s*(?:\/([^/]+)\/i|['"]([^'"]+)['"])/g)) {
    const label = match[1]?.replaceAll('\\s+', ' ') ?? match[2]; visited.push(...routeForLink(label, routes));
  }
  for (const match of text.matchAll(/path\s*:\s*['"]([^'"]+)['"]/g)) visited.push(match[1]);
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
  const routes = [
    { path: '/companies', roots: [path.join(app, 'pages/Companies.tsx')] },
    { path: '/projects', roots: [path.join(app, 'pages/Projects.tsx')] },
  ];
  const shared = path.join(app, 'src/components/ui/SharedFixture.tsx');
  const deps = new Map([
    [routes[0].roots[0], new Set([routes[0].roots[0], shared])],
    [routes[1].roots[0], new Set([routes[1].roots[0], shared])],
  ]);
  const specsFixture = [
    { file: 'e2e/AC-IMP-011-bulk-import-journey.spec.ts', route: '/companies' },
    { file: 'e2e/AC-LRC-006-companies-return.spec.ts', route: '/companies' },
    { file: 'e2e/AC-401-projects-smoke.spec.ts', route: '/projects' },
  ];
  const run = changed => routes.filter(r => changed.some(c => [...(deps.get(r.roots[0]) ?? new Set([r.roots[0]]) )].includes(c))).map(r => r.path);
  const visit = paths => specsFixture.filter(s => paths.some(p => routeMatches(p, s.route))).map(s => s.file);
  const companies = visit(run([routes[0].roots[0]]));
  const sharedSpecs = visit(run([shared]));
  if (companies.join() !== 'e2e/AC-IMP-011-bulk-import-journey.spec.ts,e2e/AC-LRC-006-companies-return.spec.ts' || sharedSpecs.join() !== 'e2e/AC-IMP-011-bulk-import-journey.spec.ts,e2e/AC-LRC-006-companies-return.spec.ts,e2e/AC-401-projects-smoke.spec.ts') throw new Error('affected-e2e self-test failed');
  console.log('Example diff: pmo-portal/pages/Companies.tsx\nSelected: e2e/AC-IMP-011-bulk-import-journey.spec.ts, e2e/AC-LRC-006-companies-return.spec.ts\nRun: scripts/e2e-local.sh --project=chromium --project=serial e2e/AC-IMP-011-bulk-import-journey.spec.ts e2e/AC-LRC-006-companies-return.spec.ts');
  console.log('Example diff: pmo-portal/src/components/ui/SharedFixture.tsx\nSelected: e2e/AC-IMP-011-bulk-import-journey.spec.ts, e2e/AC-LRC-006-companies-return.spec.ts, e2e/AC-401-projects-smoke.spec.ts\nRun: scripts/e2e-local.sh --project=chromium --project=serial e2e/AC-IMP-011-bulk-import-journey.spec.ts e2e/AC-LRC-006-companies-return.spec.ts e2e/AC-401-projects-smoke.spec.ts');
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
  const command = `scripts/e2e-local.sh --project=chromium --project=serial ${files.join(' ')}`;
  console.log(`\nRun command: ${command}`);
  if (args.includes('--run') && files.length) {
    const result = spawnSync(path.join(root, 'scripts/e2e-local.sh'), ['--project=chromium', '--project=serial', ...files], { cwd: root, stdio: 'inherit' });
    process.exit(result.status ?? 1);
  }
}
