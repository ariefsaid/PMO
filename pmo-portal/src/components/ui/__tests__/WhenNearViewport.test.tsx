/**
 * AC-PERF-003 (plan Step 1c) — WhenNearViewport mounts its children the first time they near the
 * viewport, and — the property that keeps every jsdom suite and old browser honest — renders them
 * IMMEDIATELY when IntersectionObserver is absent. Once seen, children stay mounted forever.
 */
import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WhenNearViewport } from '../WhenNearViewport';

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly options: IntersectionObserverInit | undefined;
  private readonly callback: IntersectionObserverCallback;
  private observing = false;
  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.options = options;
    FakeIntersectionObserver.instances.push(this);
  }
  observe() { this.observing = true; }
  unobserve() { /* single-target wrapper: disconnect is the only exit */ }
  disconnect() { this.observing = false; }
  takeRecords(): IntersectionObserverEntry[] { return []; }
  get isObserving() { return this.observing; }
  trigger(isIntersecting: boolean) {
    this.callback([{ isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

beforeEach(() => {
  FakeIntersectionObserver.instances = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WhenNearViewport (AC-PERF-003)', () => {
  it('renders children immediately when IntersectionObserver is absent', () => {
    // jsdom and pre-IntersectionObserver browsers: the deferral must never hide content where it
    // cannot be measured — this is the property that keeps every other unit suite unchanged.
    vi.stubGlobal('IntersectionObserver', undefined);
    render(
      <WhenNearViewport>
        <p>The work-order billing block</p>
      </WhenNearViewport>,
    );
    expect(screen.getByText('The work-order billing block')).toBeInTheDocument();
    expect(FakeIntersectionObserver.instances).toHaveLength(0);
  });

  it('observes with a 300px margin and keeps children hidden while the block is far away', () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    render(
      <WhenNearViewport>
        <p>The work-order billing block</p>
      </WhenNearViewport>,
    );
    expect(screen.queryByText('The work-order billing block')).not.toBeInTheDocument();
    const observer = FakeIntersectionObserver.instances[0];
    expect(observer.options?.rootMargin).toBe('300px');
    expect(observer.isObserving).toBe(true);
  });

  it('reserves the block height while waiting, so its arrival does not shift the page', () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    const { container } = render(
      <WhenNearViewport minHeight={280}>
        <p>The work-order billing block</p>
      </WhenNearViewport>,
    );
    const waiting = container.firstElementChild as HTMLElement;
    expect(waiting.style.minHeight).toBe('280px');
  });

  it('mounts children on intersect and keeps them mounted, disconnecting the observer', () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    render(
      <WhenNearViewport>
        <p>The work-order billing block</p>
      </WhenNearViewport>,
    );
    const observer = FakeIntersectionObserver.instances[0];
    act(() => observer.trigger(false));
    expect(screen.queryByText('The work-order billing block')).not.toBeInTheDocument();

    act(() => observer.trigger(true));
    expect(screen.getByText('The work-order billing block')).toBeInTheDocument();
    expect(observer.isObserving).toBe(false);

    // Once seen, forever seen: later non-intersecting callbacks must not unmount the children.
    act(() => observer.trigger(false));
    expect(screen.getByText('The work-order billing block')).toBeInTheDocument();
  });
});
