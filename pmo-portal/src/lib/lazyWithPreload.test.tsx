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
});
