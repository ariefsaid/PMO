// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerServiceWorker } from './pwa';

describe('registerServiceWorker (#2713)', () => {
  const originalNavigator = global.navigator;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(global, 'navigator', {
      value: originalNavigator,
      configurable: true,
      writable: true,
    });
  });

  it('AC-PWA-005: registers /sw.js with scope "/" when document is already loaded', () => {
    const registerMock = vi.fn().mockResolvedValue({} as ServiceWorkerRegistration);
    Object.defineProperty(global, 'navigator', {
      value: {
        serviceWorker: {
          register: registerMock,
        },
      },
      configurable: true,
      writable: true,
    });

    Object.defineProperty(document, 'readyState', {
      value: 'complete',
      configurable: true,
      writable: true,
    });

    registerServiceWorker();

    expect(registerMock).toHaveBeenCalledTimes(1);
    expect(registerMock).toHaveBeenCalledWith('/sw.js', { scope: '/' });
  });

  it('AC-PWA-005: defers registration to window load event when document is still loading', () => {
    const registerMock = vi.fn().mockResolvedValue({} as ServiceWorkerRegistration);
    Object.defineProperty(global, 'navigator', {
      value: {
        serviceWorker: {
          register: registerMock,
        },
      },
      configurable: true,
      writable: true,
    });

    Object.defineProperty(document, 'readyState', {
      value: 'loading',
      configurable: true,
      writable: true,
    });

    const addEventListenerSpy = vi.spyOn(window, 'addEventListener');

    registerServiceWorker();

    expect(registerMock).not.toHaveBeenCalled();
    expect(addEventListenerSpy).toHaveBeenCalledWith('load', expect.any(Function));

    // Simulate window load event
    const loadHandler = addEventListenerSpy.mock.calls.find(([event]) => event === 'load')?.[1] as
      | EventListener
      | undefined;
    expect(loadHandler).toBeDefined();
    loadHandler?.(new Event('load'));

    expect(registerMock).toHaveBeenCalledTimes(1);
    expect(registerMock).toHaveBeenCalledWith('/sw.js', { scope: '/' });
  });

  it('AC-PWA-006: swallows registration rejection gracefully without throwing', async () => {
    const registerMock = vi.fn().mockRejectedValue(new Error('Service Worker disabled by security policy'));
    Object.defineProperty(global, 'navigator', {
      value: {
        serviceWorker: {
          register: registerMock,
        },
      },
      configurable: true,
      writable: true,
    });

    Object.defineProperty(document, 'readyState', {
      value: 'complete',
      configurable: true,
      writable: true,
    });

    expect(() => registerServiceWorker()).not.toThrow();
    expect(registerMock).toHaveBeenCalledWith('/sw.js', { scope: '/' });
  });

  it('AC-PWA-006: no-ops safely when navigator.serviceWorker is not supported', () => {
    Object.defineProperty(global, 'navigator', {
      value: {},
      configurable: true,
      writable: true,
    });

    expect(() => registerServiceWorker()).not.toThrow();
  });
});
