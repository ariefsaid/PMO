import { afterEach, expect, it, vi } from 'vitest';
import { afterPaintIdle } from './afterPaintIdle';

afterEach(() => vi.unstubAllGlobals());

it('waits for a painted frame and idle before preloading, and cancels on navigation', () => {
  const frames: FrameRequestCallback[] = [];
  const idle: (() => void)[] = [];
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { frames.push(fn); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('requestIdleCallback', (fn: () => void) => { idle.push(fn); return idle.length; });
  vi.stubGlobal('cancelIdleCallback', vi.fn());
  const work = vi.fn();
  const cancel = afterPaintIdle(work);
  expect(work).not.toHaveBeenCalled();
  frames.shift()!(0);
  expect(idle).toHaveLength(0);
  frames.shift()!(16);
  expect(work).not.toHaveBeenCalled();
  idle.shift()!();
  expect(work).toHaveBeenCalledOnce();
  const cancelNext = afterPaintIdle(work);
  frames.shift()!(32);
  frames.shift()!(48);
  cancelNext();
  idle.shift()!();
  expect(work).toHaveBeenCalledOnce();
  cancel();
});
