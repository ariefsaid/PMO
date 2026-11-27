import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RouteRepositoryGraph, transformRouteImports, routeRepositoryPreload } from './routeRepositoryPreload';

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'route-repositories-'));
  roots.push(root);
  const put = (file: string, code: string) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), code);
  };
  put('src/lib/repositories/index.ts', "export const repositories = { alpha: lazy(() => import('./alpha')), beta: lazy(() => import('./beta')) };");
  put('src/lib/repositories/alpha.ts', 'export const alpha = {};');
  put('src/lib/repositories/beta.ts', 'export const beta = {};');
  put('App.tsx', "import './shell'; export const open = () => import('./pages/Own'); export const other = () => import('./pages/Other');");
  put('shell.ts', "import { repositories } from './src/lib/repositories'; repositories.alpha.read();");
  put('pages/Own.tsx', "import './part'; import type { Other } from './Other'; export default {};");
  put('pages/part.ts', "import { repositories as api } from '../src/lib/repositories'; api.alpha.read();");
  put('pages/Other.tsx', "import { repositories } from '../src/lib/repositories'; repositories.beta.read();");
  return { root, put, graph: new RouteRepositoryGraph(root) };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('route-owned repository loading', () => {
  it('includes runtime static descendants and the shell, excluding type-only and other-route lazy imports', () => {
    const { root, graph } = fixture();
    expect(graph.modulesFor(path.join(root, 'pages/Own.tsx'), true)).toEqual(['/src/lib/repositories/alpha.ts']);
    expect(graph.modulesFor(path.join(root, 'pages/Other.tsx'), true)).toEqual(['/src/lib/repositories/alpha.ts', '/src/lib/repositories/beta.ts']);
  });

  it('follows only selected runtime exports through shared barrels', () => {
    const { root, graph, put } = fixture();
    put('shared/ui.ts', "export { Own } from './Own'; export { Other } from './Other';");
    put('shared/Own.ts', "import { repositories } from '../src/lib/repositories'; export const Own = () => repositories.alpha.read();");
    put('shared/Other.ts', "import { repositories } from '../src/lib/repositories'; export const Other = () => repositories.beta.read();");
    put('pages/Own.tsx', "import { Own } from '../shared/ui'; export default Own;");
    expect(graph.modulesFor(path.join(root, 'pages/Own.tsx'), true)).toEqual(['/src/lib/repositories/alpha.ts']);
  });

  it('starts the route and its own repository modules together and returns the route only when both are ready', async () => {
    const { root, graph } = fixture();
    const source = "const open = () => import('./pages/Own');";
    const transformed = transformRouteImports(source, path.join(root, 'App.tsx'), graph)!;
    let pageReady!: (value: object) => void;
    let dataReady!: (value: object) => void;
    const load = vi.fn((file: string) => new Promise<object>((resolve) => {
      if (file === './pages/Own') pageReady = resolve;
      else dataReady = resolve;
    }));
    const open = new Function('load', transformed.replaceAll('import(', 'load(') + '; return open;')(load) as () => Promise<object>;
    let settled = false;
    const pending = open().then((page) => { settled = true; return page; });
    expect(load.mock.calls.map(([file]) => file)).toEqual(['./pages/Own', '/src/lib/repositories/alpha.ts']);
    const page = { default: 'Own route' };
    pageReady(page);
    await Promise.resolve();
    expect(settled).toBe(false);
    dataReady({});
    await expect(pending).resolves.toBe(page);
  });

  it('also prepares an owned nested section, without adding shell dependencies to unrelated utility imports', () => {
    const { root, graph, put } = fixture();
    put('pages/Own.tsx', "import { repositories } from '../src/lib/repositories'; repositories.beta.read();");
    const source = "export const section = () => import('./Own');";
    const code = transformRouteImports(source, path.join(root, 'pages/Section.tsx'), graph)!;
    expect(code).toContain("import(\"/src/lib/repositories/beta.ts\")");
    expect(code).not.toContain('alpha.ts');
    expect(transformRouteImports("const x = import('./missing');", path.join(root, 'pages/Own.tsx'), graph)).toBeNull();
  });
  it('honors the project config and refreshes cached dependencies on a watched source edit', () => {
    const { root, put } = fixture();
    put('tsconfig.json', JSON.stringify({ compilerOptions: { moduleResolution: 'bundler', paths: { '@/*': ['./*'] } } }));
    const plugin = routeRepositoryPreload(root);
    const apply = plugin.apply as (config: object, environment: { mode: string }) => boolean;
    expect(apply({}, { mode: 'test' })).toBe(false);
    expect(apply({}, { mode: 'production' })).toBe(true);
    const transform = plugin.transform as (code: string, id: string) => { code: string } | null;
    const source = "const open = () => import('./pages/Own');";
    expect(transform(source, path.join(root, 'App.tsx'))?.code).not.toContain('beta.ts');
    put('pages/part.ts', "import { repositories as api } from '@/src/lib/repositories'; api['beta'].read();");
    (plugin.watchChange as () => void)();
    expect(transform(source, path.join(root, 'App.tsx'))?.code).toContain('beta.ts');
    expect(transform(source, '/outside/App.tsx')).toBeNull();
    expect(transform('body {}', path.join(root, 'style.css'))).toBeNull();
    expect(transform(source, path.join(root, 'node_modules/example/index.ts'))).toBeNull();
    expect(transform(source, path.join(root, 'src/lib/repositories/index.ts'))).toBeNull();
  });

  it('rejects an unresolvable repository domain rather than leaving another query-time waterfall', () => {
    const { root, graph, put } = fixture();
    put('pages/Own.tsx', "import { repositories } from '../src/lib/repositories'; repositories.missing.read();");
    expect(() => graph.modulesFor(path.join(root, 'pages/Own.tsx'))).toThrow('No implementation module');
    graph.clear();
    put('pages/Own.tsx', "import { repositories } from '../src/lib/repositories'; const key = 'alpha'; repositories[key].read();");
    expect(() => graph.modulesFor(path.join(root, 'pages/Own.tsx'))).toThrow('Name the repository domain');
  });

});
