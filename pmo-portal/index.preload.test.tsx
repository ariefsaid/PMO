import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ preloadForPath: vi.fn(), render: vi.fn() }));
vi.mock('./index.css', () => ({}));
vi.mock('./App', () => ({ default: () => null, createAppRouter: () => ({}), preloadForPath: h.preloadForPath }));
vi.mock('@/src/lib/chunkReload', () => ({ installChunkReloadGuard: () => {} }));
vi.mock('react-dom/client', () => ({ default: { createRoot: () => ({ render: h.render }) }, createRoot: () => ({ render: h.render }) }));

describe('#2100 the opening route starts loading before the app renders', () => {
  beforeEach(() => {
    vi.resetModules();
    h.preloadForPath.mockClear();
    h.render.mockClear();
    document.body.innerHTML = '<div id="root"></div>';
  });

  it('preloads the deep link the browser opened with, ahead of the first render', async () => {
    window.history.pushState({}, '', '/projects/p1?view=timeline');
    await import('./index');
    expect(h.preloadForPath).toHaveBeenCalledWith('/projects/p1?view=timeline');
    expect(h.preloadForPath.mock.invocationCallOrder[0]).toBeLessThan(h.render.mock.invocationCallOrder[0]);
  });
});
