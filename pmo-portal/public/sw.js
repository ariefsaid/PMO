/**
 * Minimal Service Worker for PWA Home-Screen Installability (#2713).
 *
 * Explicitly NO offline caching of data: offline capture is scheduled for Q1 2027
 * per OD-SCOPE-15 and OD-SCOPE-16. All network requests pass through to the network
 * directly without caching.
 */

self.addEventListener('install', () => {
  // Activate immediately rather than waiting for next page reload
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Take control of all open pages immediately
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', () => {
  // Pass-through: allow browser to handle all requests directly.
  // Strictly NO offline caching of data or credentials.
});
