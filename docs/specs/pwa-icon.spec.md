# Installable web app: home-screen icon on the phone (#2713)

- **Map:** #2516 (contractor field operations). **ADR:** none required (standard web platform capability). **Plan:** `docs/plans/2026-11-21-pwa-icon.md`.
- **Job story:** When I use PMO on a phone, I want an icon on the home screen that opens it like an app, so field staff reach it in one tap.
- **Out of scope here:** Offline capture and offline foreman phone entry (scheduled for Q1 2027 per OD-SCOPE-1, OD-SCOPE-15, OD-SCOPE-16); a native Android app (outside the proposal per OD-SCOPE-14, OD-SCOPE-16).
- **Settings the client controls:** None.

## Requirements (EARS)

- **FR-PWA-001** The web application shall provide a Web App Manifest at `/manifest.webmanifest` declaring `name`, `short_name`, `start_url`, `display: standalone`, `theme_color`, `background_color`, and icon definitions.
- **FR-PWA-002** The Web App Manifest shall define icons in standard dimensions (including 192x192 and 512x512) for both standard (`any`) and adaptive (`maskable`) display, referencing valid icon assets.
- **FR-PWA-003** The HTML document entry (`index.html`) shall link to the Web App Manifest, the brand favicon, the Apple touch icon, and declare mobile web app meta tags (`theme-color`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, `apple-mobile-web-app-title`).
- **FR-PWA-004** The web application shall provide a minimal service worker at `/sw.js` registered under the root scope `/` that satisfies browser installability criteria by handling `install`, `activate`, and `fetch` events.
- **FR-PWA-005** The service worker shall NOT perform offline caching of application data, API responses, or mutation states; all network traffic shall pass through to the network directly.
- **FR-PWA-006** The web application entry shall register the service worker when the browser environment supports `navigator.serviceWorker`, without competing with the critical initial page render or throwing in unsupported environments.
- **NFR-PWA-001** The theme color and icon styling shall align with the DESIGN.md primary brand token (`#4B61DC`) and calm monochrome design system.
- **NFR-PWA-002** Existing application routes, authentication flows, and data queries shall remain completely unchanged.

## Acceptance criteria

- **AC-PWA-001** Given the web application root, When a client requests `/manifest.webmanifest`, Then the response is a valid JSON document containing `name: "PMO Portal"`, `short_name: "PMO"`, `start_url: "/"`, `display: "standalone"`, `theme_color: "#4B61DC"`, `background_color: "#ffffff"`, and an `icons` array containing 192x192 and 512x512 icons with purposes `any` and `maskable`.
- **AC-PWA-002** Given `pmo-portal/public/`, When inspecting the icon assets, Then `favicon.svg`, `icon-192.png`, `icon-512.png`, `icon-192-maskable.png`, `icon-512-maskable.png`, and `apple-touch-icon.png` exist with valid dimensions and file formats.
- **AC-PWA-003** Given `pmo-portal/index.html`, When inspecting the `<head>` markup, Then it contains `<link rel="manifest" href="/manifest.webmanifest">`, `<link rel="icon" type="image/svg+xml" href="/favicon.svg">`, `<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">`, and `<meta name="theme-color" content="#4B61DC">`.
- **AC-PWA-004** Given `pmo-portal/public/sw.js`, When the service worker script is inspected, Then it registers handlers for `install`, `activate`, and `fetch` events, and contains zero cache storage writes (`caches.open`, `cache.put`, `cache.add`).
- **AC-PWA-005** Given a browser with service worker support, When the application mounts, Then `registerServiceWorker()` registers `/sw.js` with `{ scope: '/' }` on or after page load.
- **AC-PWA-006** Given an environment without service worker support or where registration fails, When the application mounts, Then `registerServiceWorker()` catches the error gracefully and does not throw or interrupt application startup.

## Owning layer

| AC | Layer | Test |
|---|---|---|
| AC-PWA-001, AC-PWA-002 | Unit / Node | `pmo-portal/test/manifest.test.ts` |
| AC-PWA-003 | Unit / Node | `pmo-portal/test/pwaIndexHtml.test.ts` |
| AC-PWA-004 | Unit / Node | `pmo-portal/test/serviceWorker.test.ts` |
| AC-PWA-005, AC-PWA-006 | Unit / JSDOM | `pmo-portal/src/lib/pwa.test.ts` |

## Open questions

None. The requirements are locked by issue #2713 and OD-SCOPE-16.
