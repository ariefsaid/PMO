import { afterEach, describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { lazyWithPreload } from './lazyWithPreload';

afterEach(cleanup);

describe('lazyWithPreload', () => {
  const factory = vi.fn(() =>
    Promise.resolve({ default: () => <div>lazy content</div> }),
  );

  it('starts the import exactly once across repeated preload() calls (#1834)', () => {
    const Lazy = lazyWithPreload(factory);
    const first = Lazy.preload();
    const second = Lazy.preload();

    expect(factory).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    void first;
  });

  it('rendering after preload() reuses the in-flight import — no second import', async () => {
    const Lazy = lazyWithPreload(factory);
    void Lazy.preload();

    render(
      <React.Suspense fallback={<div>loading</div>}>
        <Lazy />
      </React.Suspense>,
    );

    await waitFor(() => expect(screen.getByText('lazy content')).toBeTruthy());
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('rendering without preload() still loads, through the same memoized import', async () => {
    const Lazy = lazyWithPreload(factory);
    render(
      <React.Suspense fallback={<div>loading</div>}>
        <Lazy />
      </React.Suspense>,
    );
    expect(screen.getByText('loading')).toBeTruthy();

    await waitFor(() => expect(screen.getByText('lazy content')).toBeTruthy());
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('preload() resolves with the module default', async () => {
    const Lazy = lazyWithPreload(factory);
    const loaded = await Lazy.preload();
    expect(typeof loaded.default).toBe('function');
  });

  it('a rejected import is not cached — the next preload() retries and resolves (#1834 follow-up)', async () => {
    const flaky = vi.fn()
      .mockImplementationOnce(() => Promise.reject(new Error('offline')))
      .mockImplementation(() => Promise.resolve({ default: () => <div>retried content</div> }));
    const Lazy = lazyWithPreload(flaky);

    await expect(Lazy.preload()).rejects.toThrow('offline');
    expect(flaky).toHaveBeenCalledTimes(1);

    // The memo was reset on rejection: the next preload() starts a FRESH import...
    const retried = Lazy.preload();
    await expect(retried).resolves.toHaveProperty('default');
    expect(flaky).toHaveBeenCalledTimes(2);

    // ...and once the retry resolves, memoization holds again — no third import.
    await Lazy.preload();
    expect(flaky).toHaveBeenCalledTimes(2);
  });
});
