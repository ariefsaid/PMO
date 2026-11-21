/**
 * PWA Service Worker Registration (#2713).
 *
 * Registers the minimal service worker for installability on mobile/desktop browsers.
 * Explicitly NO offline caching of data: passes network requests directly.
 */

export function registerServiceWorker(): void {
  if (typeof window === 'undefined' || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  const register = (): void => {
    try {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        // Silently swallow registration failures in restricted or unsupported contexts
      });
    } catch {
      // Guard against synchronous exceptions in security-restricted environments
    }
  };

  if (document.readyState === 'complete') {
    register();
  } else {
    window.addEventListener('load', register);
  }
}
