# Implementation plan — Legal Pages + Help Links (GTM MVP item 4 — Legal floor, Indonesia)

- **Date:** 2026-07-04
- **Issue:** GTM MVP item 4 — Legal floor (Indonesia).
- **Author:** eng-planner (Claude Opus 4.8 · 1M)
- **Spec:** `docs/specs/legal-pages.spec.md` (**SIGNED; 2-model battery passed — do NOT re-litigate.**) FR-LEG-001..031, NFR-LEG-001..006, AC-LEG-001..035 (AC-LEG-003 deleted). This plan operationalizes the spec; the spec is the authority on behavior.
- **Reference slice (pattern to copy, do not reinvent):** the public-route + bare-page pattern is `App.tsx` root `<Routes>` (`/login` eager beside the `RequireAuth` wrapper); the page-shell pattern is `src/components/shell/AppShell.tsx` (skip link `:142-145`, `<main id="main">` `:167-168`); the env-var seam pattern is `src/lib/features.ts` (`import.meta.env.VITE_* ?? default`).
- **No new ADR.** Every decision here is a direct application of (a) the existing `VITE_*` build-time env convention (`docs/environments.md`), (b) the existing public-route pattern (`/login`), (c) the existing skip-link/`<main>` landmark pattern (`AppShell.tsx`), and (d) ADR-0047 (hosting location = config-seamed). Nothing irreversible or cross-cutting — no ADR warranted.

---

## 0. Authority reconciliation & reality-anchor verification (binding — read before building)

The spec cites file:line anchors that were re-verified on 2026-07-04 against the current tree. **All load-bearing anchors hold.** Line numbers below are the verified current positions.

| Anchor (spec) | Verified reality (2026-07-04) | Binding for this plan |
|---|---|---|
| `App.tsx:405-408` — public route placement beside `/login` | The root `<Routes>` (inside `BrowserRouter > AnalyticsProvider`) is `<Route path="/login" element={<LoginPage />} />` then `<Route element={<RequireAuth />}><Route path="/*" element={<Shell />} /></Route>`. `/login` is **eager** (not lazy). | `/terms` and `/privacy` are added as **eager siblings of `/login`**, outside the `RequireAuth` wrapper, before the `path="/*"` catch-all. Eager (not lazy) — matches `/login` and avoids a root-level `<Suspense>` the root routes don't have. |
| `App.tsx:407-408` + `RequireAuth.tsx` `!session → Navigate to="/login"` | `RequireAuth.tsx`: `if (!session) return <Navigate to="/login" replace />;`. `/` lives under `RequireAuth` → unauthed users landing on `/` bounce to `/login`. | Confirms the auth-aware back link destinations: unauthed primary audience → `/login` (not `/`); authed → `/` (FR-LEG-005, AC-LEG-030, I9). |
| `ContextBar.tsx:116` desktop right-cluster | `<div className="hidden items-center gap-3.5 sm:flex">` = the inline role-switcher + user chip + Sign out cluster, visible **≥640px** (`sm:flex`). | The ONE inline Help icon-link goes inside this `sm:flex` div, immediately before the Sign out `<button>`. Add `data-testid="desktop-account-cluster"` for scoped RTL. |
| `ContextBar.tsx:196` mobile account menu | `<div className="relative sm:hidden" ref={acctRef}>` = the avatar-trigger `acctOpen` dropdown, visible **<640px** (`sm:hidden`). | Terms/Privacy/Help `menuitem` entries go inside the `acctOpen && (...)` menu panel, after the role-switcher block and before the Sign out separator. Add `data-testid="mobile-account-menu"` for scoped RTL + e2e. |
| `AppShell.tsx:142-145` skip link + `:167-168` `<main id="main">` | Skip link: `<a href="#main" className="sr-only z-[1000] ... focus:not-sr-only ...">Skip to main content</a>`. Main: `<main id="main" ref={mainRef} tabIndex={-1} ...>`. | `LegalPageLayout` reproduces BOTH verbatim (the bare pages render outside `<Shell>`, so they cannot inherit the shell's `<main>`/skip link — M10). |
| gate files `ROUTES` `:34`/`:30`, loop `:93`/`:109`, `goto` `:97`/`:113` | `AC-MOBILE-OVERFLOW-001…spec.ts`: `const ROUTES` at `:34`, `for (const route of ROUTES)` at `:93`, `page.goto(route.path)` at `:97`. `AC-VISUAL-ICON-001…spec.ts`: `ROUTES` at `:30`, loop at `:109`, `goto` at `:113`. Both gates `signIn(page,'admin@acme.test')` **then** `goto` — and the public pages render their bare page regardless of auth (FR-LEG-003), so inclusion is safe. | Add `{ path: '/terms', label: 'terms' }` + `{ path: '/privacy', label: 'privacy' }` to each array. No automatic registration exists (C2). |
| `docs/environments.md:143,157-168` `VITE_*` convention | The "Frontend on Cloudflare Pages" section lists build-time `VITE_*` vars set per-environment. | Slice 5 adds the `VITE_LEGAL_*` provisioning block there. |
| `index.html` viewport `width=device-width, initial-scale=1.0` | `index.html:7`: `<meta name="viewport" content="width=device-width, initial-scale=1.0" />` (no `user-scalable=no` / `maximum-scale`). | NFR-LEG-002 satisfied-by-existing — **no work**. |
| `index.css` `--primary-text` | `index.css:46` `--primary-text: 221.2 83.2% 45%` (light) / `:107` `221 90% 72%` (dark) → the AA blue text token (DESIGN.md §6: 6.81:1 on canvas). Maps to the `text-primary-text` utility (LoginPage already uses it for its demo-persona links). | All legal/login/help **blue text links** use `text-primary-text` (AA blue) — NOT `text-primary` (the action fill, ~3.5:1 sub-AA on dark per DESIGN.md known gap). |

### Constants this plan fixes (spec left them to the eng-plan)
- **Env-var names** are taken **verbatim from the spec FR-LEG-007 table** — do NOT "normalize" them:
  - `LEGAL_ENTITY_NAME` ← `VITE_LEGAL_ENTITY_NAME`
  - `DOMAIN` ← `VITE_LEGAL_DOMAIN`
  - `CONTACT_EMAIL` ← `VITE_LEGAL_CONTACT_EMAIL`
  - `HELP_WHATSAPP` ← **`VITE_HELP_WHATSAPP`** (no `LEGAL` infix — legacy-unprefixed)
  - `HOSTING_LOCATION` ← **`VITE_HOSTING_LOCATION`** (no `LEGAL` infix — legacy-unprefixed)
  - Defaults: `"PMO Portal"` · `"pmoportal.app"` · `"support@pmoportal.app"` · `""` · `"Singapore"`.
- **`HELP_URL`** is a derived export (`HELP_WHATSAPP ? \`https://wa.me/${HELP_WHATSAPP}\` : ''`); consumers check truthiness before rendering a Help affordance (FR-LEG-010).
- **Help icon** = `<Icon name="message" />` (the chat-bubble glyph in `ICON_PATHS`, `src/components/ui/iconPaths.tsx`) — the most semantically-apt icon for "Contact support via WhatsApp". `aria-label="Contact support via WhatsApp"` (FR-LEG-028, AC-LEG-025).

### Out-of-scope (do NOT add — spec §1.2)
- Cookie banner / consent / GDPR self-service / ToS acceptance checkboxes / CMS-markdown pipeline. Hardcoded TSX prose is correct for MVP.
- **No new dropdowns.** Desktop gets ONE inline icon-**link** (an `<a>`, not a menu); Terms/Privacy are NOT on desktop chrome (reachable via login footer, legal cross-links, direct URL).

---

## 1. Architecture & data flow

```
Build time (Vite)
  import.meta.env.VITE_LEGAL_*  ──►  src/lib/legalConfig.ts  (ONE typed seam, FR-LEG-006/007)
   ├─ LEGAL_ENTITY_NAME / DOMAIN / CONTACT_EMAIL   (presentable defaults; never a bracket)
   ├─ HELP_WHATSAPP (E.164)  ──►  HELP_URL = `https://wa.me/${HELP_WHATSAPP}` | ''
   └─ HOSTING_LOCATION  (per-client Supabase Cloud Pro; ADR-0047)

Browser (BrowserRouter, App root)
  <Routes>
    <Route path="/login"   element={<LoginPage/>} />          ← existing, eager
    <Route path="/terms"   element={<TermsPage/>} />          ← NEW, eager (sibling of /login)
    <Route path="/privacy" element={<PrivacyPage/>} />        ← NEW, eager (sibling of /login)
    <Route element={<RequireAuth/>}>                          ← existing
      <Route path="/*" element={<Shell/>} />                  ← /terms & /privacy match BEFORE the wildcard
    </Route>
  </Routes>

  /terms, /privacy (PUBLIC — outside RequireAuth; same bare page for everyone, FR-LEG-003)
    pages/Terms.tsx / pages/Privacy.tsx
      └─ <LegalPageLayout>  (src/components/legal/LegalPageLayout.tsx — the shared chrome)
           ├─ <a href="#main">Skip to main content</a>        (AC-LEG-033)
           ├─ <main id="main" tabIndex={-1}>                  (AC-LEG-032 — exactly ONE)
           │    ├─ overline eyebrow (11/600/0.06em)
           │    ├─ <h1> page-title (24/700/-0.02em)           (AC-LEG-004/027)
           │    ├─ top nav row: back(auth-aware) · cross-link · Help(wa.me,_blank)
           │    │    └─ back = useAuth().session ? "Back to app"→/ : "Back to sign in"→/login   (AC-LEG-030)
           │    └─ <div class="prose"> {children = the <h2> sections} </div>
           └─ renders OUTSIDE <Shell> → owns its own <main>+skip-link (cannot inherit shell's)

  Entry points into /terms, /privacy, wa.me (the public audience's paths in):
    LoginPage footer       (auth/LoginPage.tsx)   Terms · Privacy · Help   (FR-LEG-023, AC-LEG-021)
    Desktop cluster ≥640px (shell/ContextBar.tsx)  ONE inline Help icon-link next to Sign out (FR-LEG-028, AC-LEG-025)
    Mobile acct menu <640px(shell/ContextBar.tsx)  Terms · Privacy · Help menuitems (FR-LEG-027, AC-LEG-023)

Deterministic gates (Layer-1, hand-maintained ROUTES — no auto-registration, C2)
  e2e/AC-MOBILE-OVERFLOW-001… + AC-VISUAL-ICON-001…  ← /terms & /privacy added to both ROUTES arrays (FR-LEG-029, AC-LEG-026)
```

**Why one shared `LegalPageLayout` (not two copy-pasted pages).** Both pages share the entire chrome contract — skip link, single `<main>`, h1 page-title, auth-aware back link, sibling cross-link, Help link, prose container, DESIGN.md tokens. The spec assigns the shared-behavior ACs (027–033, 035) to BOTH `Terms.test.tsx` and `Privacy.test.tsx`; a shared layout means both pages are provably identical on those ACs by construction (and the duplicated assertions catch a page accidentally dropping a layout feature). The pages own only their **content** (the `<h2>` sections + clause prose).

**Auth-aware back link without a Shell.** `LegalPageLayout` calls `useAuth().session`. `AuthProvider` mounts at the App root (`App.tsx`), **above** the router, so `useAuth()` resolves on both authenticated and unauthenticated renders of the public route — no new provider needed. (The page renders for everyone; `session` is `null` for the unauthed primary audience and truthy for an authed user who navigates to `/terms`.)

**No cookie / consent / dropdown.** Hardcoded TSX prose (spec §1.2 OUT). Desktop Help is a single `<a>` icon-link, not a menu.

---

## 2. File tree (exact paths — NEW unless EDIT)

```
pmo-portal/
  src/
    lib/
      legalConfig.ts                                    NEW   the ONE typed seam (FR-LEG-006/007) + HELP_URL
      legalConfig.test.ts                               NEW   AC-LEG-005/008/034 (defaults + override + Help URL)
      legal-route-registry.test.ts                      NEW   AC-LEG-026 (presence in BOTH gate ROUTES arrays, via fs)
    components/
      legal/
        LegalPageLayout.tsx                             NEW   shared chrome: skip link + <main id="main"> + h1 + back/cross/Help + prose
    auth/
      LoginPage.tsx                                     EDIT  + <footer> Terms·Privacy·Help (FR-LEG-023)
      LoginPage.test.tsx                                EDIT  + vi.mock legalConfig + AC-LEG-021
    components/
      shell/
        ContextBar.tsx                                  EDIT  + desktop Help icon-link (data-testid) + mobile menu entries (data-testid)
        ContextBar.test.tsx                             NEW   AC-LEG-023/025 (+ Help-omitted-when-empty)
    vite-env.d.ts                                       EDIT  + the 5 VITE_* env typings
  pages/
    Terms.tsx                                           NEW   8 <h2> sections; Governing Law heading-only (FR-LEG-011-014)
    Terms.test.tsx                                      NEW   AC-LEG-001/004/006/009-012/027-033/035
    Privacy.tsx                                         NEW   9 <h2> sections incl AI disclosure (FR-LEG-015-022)
    Privacy.test.tsx                                    NEW   AC-LEG-002/007/013-020/027-033/035
  App.tsx                                               EDIT  + eager imports + /terms + /privacy routes outside RequireAuth
  e2e/
    AC-LEG-022-login-footer.spec.ts                     NEW   AC-LEG-022 (E2E)
    AC-LEG-024-mobile-account-menu.spec.ts              NEW   AC-LEG-024 (E2E)
    AC-MOBILE-OVERFLOW-001-no-horizontal-bleed.spec.ts  EDIT  ROUTES += /terms, /privacy  (AC-LEG-026 target #1)
    AC-VISUAL-ICON-001-no-oversized-icons.spec.ts       EDIT  ROUTES += /terms, /privacy  (AC-LEG-026 target #2)
docs/
  environments.md                                       EDIT  + VITE_LEGAL_* provisioning block (Slice 5)
```

---

## 3. Traceability (AC → owning test, ADR-0010 lowest-sufficient layer; spec §7 honored)

Each AC appears in **exactly one row** (owning layer + primary test). "Shared-layout" ACs are owned at Unit/RTL; where the spec lists two page-test files, the primary is named first and the secondary is a `(+ …)` reference (same layer, both assert it — the layout is shared so both pages are provably identical on it).

| AC | Layer | Owning test (title / file) |
|---|---|---|
| AC-LEG-001 | Unit/RTL | `Terms page · AC-LEG-001: renders the bare Terms page (title + no AppShell chrome)` · `pages/Terms.test.tsx` |
| AC-LEG-002 | Unit/RTL | `Privacy page · AC-LEG-002: renders the bare Privacy page (title + no AppShell chrome)` · `pages/Privacy.test.tsx` |
| ~~AC-LEG-003~~ | — | *deleted in spec (I4)* |
| AC-LEG-004 | Unit/RTL | `Terms page · AC-LEG-004/027: h1 page-title token + h2 section headings, exactly one h1` · `pages/Terms.test.tsx` (+ `Privacy.test.tsx`) |
| AC-LEG-005 | Unit | `legalConfig · AC-LEG-005/034-default: exports the five typed constants with presentable defaults` · `src/lib/legalConfig.test.ts` |
| AC-LEG-006 | Unit/RTL | `Terms page · AC-LEG-006: renders config values, no bracket placeholders` · `pages/Terms.test.tsx` |
| AC-LEG-007 | Unit/RTL | `Privacy page · AC-LEG-007: renders config values incl hosting location, no bracket placeholders` · `pages/Privacy.test.tsx` |
| AC-LEG-008 | Unit | `legalConfig · AC-LEG-008: HELP_URL is wa.me/<E.164> when set; empty when unset` · `src/lib/legalConfig.test.ts` |
| AC-LEG-009 | Unit/RTL | `Terms page · AC-LEG-009: all 8 section headings present; Governing Law heading-only` · `pages/Terms.test.tsx` |
| AC-LEG-010 | Unit/RTL | `Terms page · AC-LEG-010: Services section references the MSA` · `pages/Terms.test.tsx` |
| AC-LEG-011 | Unit/RTL | `Terms page · AC-LEG-011: Data Ownership affirms client ownership` · `pages/Terms.test.tsx` |
| AC-LEG-012 | Unit/RTL | `Terms page · AC-LEG-012: Term and Termination includes initial/renewal/convenience/cause` · `pages/Terms.test.tsx` |
| AC-LEG-013 | Unit/RTL | `Privacy page · AC-LEG-013: all 9 section headings present` · `pages/Privacy.test.tsx` |
| AC-LEG-014 | Unit/RTL | `Privacy page · AC-LEG-014: Data Ownership affirms client ownership` · `pages/Privacy.test.tsx` |
| AC-LEG-015 | Unit/RTL | `Privacy page · AC-LEG-015: Data Location states hosting location` · `pages/Privacy.test.tsx` |
| AC-LEG-016 | Unit/RTL | `Privacy page · AC-LEG-016: Data Export describes CSV/XLSX anytime + 30-day termination export` · `pages/Privacy.test.tsx` |
| AC-LEG-017 | Unit/RTL | `Privacy page · AC-LEG-017: Data Retention and Deletion states 60–90 days` · `pages/Privacy.test.tsx` |
| AC-LEG-018 | Unit/RTL | `Privacy page · AC-LEG-018: AI Processing Disclosure matches MSA brief §4` · `pages/Privacy.test.tsx` |
| AC-LEG-019 | Unit/RTL | `Privacy page · AC-LEG-019: Confidentiality and Security describes protections` · `pages/Privacy.test.tsx` |
| AC-LEG-020 | Unit/RTL | `Privacy page · AC-LEG-020: Contact Us displays contact email + WhatsApp help link` · `pages/Privacy.test.tsx` |
| AC-LEG-021 | Unit/RTL | `LoginPage · AC-LEG-021: footer has Terms, Privacy, Help links` · `src/auth/LoginPage.test.tsx` |
| AC-LEG-022 | E2E | `AC-LEG-022 Terms / Privacy / Help from the login footer` · `e2e/AC-LEG-022-login-footer.spec.ts` |
| AC-LEG-023 | Unit/RTL | `ContextBar · AC-LEG-023: mobile account menu includes Terms, Privacy, Help` · `src/components/shell/ContextBar.test.tsx` |
| AC-LEG-024 | E2E | `AC-LEG-024 Terms / Privacy / Help from the mobile account menu` · `e2e/AC-LEG-024-mobile-account-menu.spec.ts` |
| AC-LEG-025 | Unit/RTL | `ContextBar · AC-LEG-025: desktop cluster ONE inline Help icon-link, no Terms/Privacy` · `src/components/shell/ContextBar.test.tsx` |
| AC-LEG-026 | Unit | `legal-route-registry · AC-LEG-026 — legal routes present in both sweep ROUTES arrays` · `src/lib/legal-route-registry.test.ts` |
| AC-LEG-027 | Unit/RTL | `Terms page · AC-LEG-004/027: h1 page-title token + h2 section headings, exactly one h1` · `pages/Terms.test.tsx` (+ `Privacy.test.tsx`) |
| AC-LEG-028 | Unit/RTL | `Terms page · AC-LEG-028: links have descriptive labels; Help aria-label` · `pages/Terms.test.tsx` (+ `Privacy.test.tsx`) |
| AC-LEG-029 | Unit/RTL | `Terms page · AC-LEG-029: foreground uses text-foreground token` · `pages/Terms.test.tsx` (+ `Privacy.test.tsx`) |
| AC-LEG-030 | Unit/RTL | `Terms page · AC-LEG-030: auth-aware back link` · `pages/Terms.test.tsx` (+ `Privacy.test.tsx`) |
| AC-LEG-031 | Unit/RTL | `Terms page · AC-LEG-031: cross-links sibling + Help + back` · `pages/Terms.test.tsx` (+ `Privacy.test.tsx`) |
| AC-LEG-032 | Unit/RTL | `Terms page · AC-LEG-032: exactly one <main> landmark id="main"` · `pages/Terms.test.tsx` (+ `Privacy.test.tsx`) |
| AC-LEG-033 | Unit/RTL | `Terms page · AC-LEG-033: skip link targets #main` · `pages/Terms.test.tsx` (+ `Privacy.test.tsx`) |
| AC-LEG-034 | Unit | `legalConfig · AC-LEG-034-override: reads VITE_LEGAL_* overrides` · `src/lib/legalConfig.test.ts` (secondary render proof: `pages/Terms.test.tsx` AC-LEG-006) |
| AC-LEG-035 | Unit/RTL | `Terms page · AC-LEG-035: deterministic render — same config → identical text` · `pages/Terms.test.tsx` (+ `Privacy.test.tsx`) |

**NFR coverage:** NFR-LEG-001 (no horizontal bleed @390/360) is enforced by the `AC-MOBILE-OVERFLOW-001` gate once `/terms`+`/privacy` are in its ROUTES (AC-LEG-026 → gate iteration). NFR-LEG-002 = existing `index.html` tag (no work). NFR-LEG-003/004 = AC-LEG-027/028/029/032/033 (token + landmark + label assertions; contrast is a DESIGN.md §6 invariant proven on the tokens, not re-computed per PR — ADR-0010/M13). NFR-LEG-005 = the `legalConfig` seam itself (AC-LEG-005). NFR-LEG-006 (determinism) = AC-LEG-035.

**Self-verify (every AC placed exactly once):** AC-LEG-001..035 minus deleted 003 = **34 ACs**, all present in the table above, each in exactly one row, each mapped to one owning test. ✓

---

## SLICE 1 — `legalConfig.ts` seam + unit tests

> **TDD env note (load-bearing).** `legalConfig.ts` reads `import.meta.env.VITE_*` at **module-load** time, so a test cannot stub env *after* a static `import` and see the change. The canonical Vitest pattern is `vi.resetModules()` + `vi.stubEnv(...)` + **dynamic `import()`** — the dynamic import re-evaluates the module against the freshly-stubbed env. `beforeEach` calls `vi.resetModules()` + `vi.unstubAllEnvs()` so every test starts clean.

### Task 1.1 — Write `legalConfig.test.ts` (RED) — AC-LEG-005/008/034
**File:** `pmo-portal/src/lib/legalConfig.test.ts` (NEW)
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('legalConfig (AC-LEG-005, AC-LEG-008, AC-LEG-034)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('AC-LEG-005 / AC-LEG-034-default: exports the five typed constants with presentable defaults when env unset', async () => {
    // No stubs → every VITE_LEGAL_* is undefined → presentable defaults (never a bracket).
    const mod = await import('./legalConfig');
    expect(mod.LEGAL_ENTITY_NAME).toBe('PMO Portal');
    expect(mod.DOMAIN).toBe('pmoportal.app');
    expect(mod.CONTACT_EMAIL).toBe('support@pmoportal.app');
    expect(mod.HELP_WHATSAPP).toBe('');
    expect(mod.HOSTING_LOCATION).toBe('Singapore');
  });

  it('AC-LEG-034-override: reads VITE_LEGAL_* overrides from import.meta.env', async () => {
    vi.stubEnv('VITE_LEGAL_ENTITY_NAME', 'Acme Pty Ltd');
    vi.stubEnv('VITE_LEGAL_DOMAIN', 'acme.example');
    vi.stubEnv('VITE_LEGAL_CONTACT_EMAIL', 'legal@acme.example');
    vi.stubEnv('VITE_HELP_WHATSAPP', '6281234567890');
    vi.stubEnv('VITE_HOSTING_LOCATION', 'Jakarta');
    const mod = await import('./legalConfig');
    expect(mod.LEGAL_ENTITY_NAME).toBe('Acme Pty Ltd');
    expect(mod.DOMAIN).toBe('acme.example');
    expect(mod.CONTACT_EMAIL).toBe('legal@acme.example');
    expect(mod.HELP_WHATSAPP).toBe('6281234567890');
    expect(mod.HOSTING_LOCATION).toBe('Jakarta');
  });

  it('AC-LEG-008: HELP_URL is https://wa.me/<E.164> when HELP_WHATSAPP set', async () => {
    vi.stubEnv('VITE_HELP_WHATSAPP', '6281234567890');
    const mod = await import('./legalConfig');
    expect(mod.HELP_URL).toBe('https://wa.me/6281234567890');
  });

  it('AC-LEG-008 / FR-LEG-010: HELP_URL is empty (Help omitted) when HELP_WHATSAPP unset', async () => {
    const mod = await import('./legalConfig');
    expect(mod.HELP_WHATSAPP).toBe('');
    expect(mod.HELP_URL).toBe('');
  });

  it('AC-LEG-005: all five constants are typed as string', async () => {
    const mod = await import('./legalConfig');
    for (const v of [mod.LEGAL_ENTITY_NAME, mod.DOMAIN, mod.CONTACT_EMAIL, mod.HELP_WHATSAPP, mod.HOSTING_LOCATION, mod.HELP_URL]) {
      expect(typeof v).toBe('string');
    }
  });
});
```
**Verify (RED):** `cd pmo-portal && npx vitest run src/lib/legalConfig.test.ts` → fails (`Failed to resolve import "./legalConfig"`).

### Task 1.2 — Write `legalConfig.ts` + augment `vite-env.d.ts` (GREEN) — AC-LEG-005/008/034
**File:** `pmo-portal/src/lib/legalConfig.ts` (NEW)
```ts
/**
 * Legal configuration seam — the ONE typed source for every site-specific value
 * the legal pages render (FR-LEG-006/007, NFR-LEG-005). Reads `VITE_LEGAL_*`
 * (plus the two legacy-unprefixed vars) build-time env vars and exports typed
 * constants with PRESENTABLE DEFAULTS so an unset env var NEVER renders a bracket
 * placeholder (FR-LEG-007, I6).
 *
 * Env-var naming is verbatim from spec FR-LEG-007 — do NOT "normalize":
 *   LEGAL_ENTITY_NAME ← VITE_LEGAL_ENTITY_NAME   (default "PMO Portal")
 *   DOMAIN            ← VITE_LEGAL_DOMAIN        (default "pmoportal.app")
 *   CONTACT_EMAIL     ← VITE_LEGAL_CONTACT_EMAIL (default "support@pmoportal.app")
 *   HELP_WHATSAPP     ← VITE_HELP_WHATSAPP        (default ""  → Help omitted, FR-LEG-010)
 *   HOSTING_LOCATION  ← VITE_HOSTING_LOCATION     (default "Singapore"; per-client, ADR-0047)
 *
 * Provisioning: set these per client at build time — see docs/environments.md
 * "Frontend on Cloudflare Pages". HELP_WHATSAPP is a single global value for the
 * single-tenant MVP; the org_id seam makes it per-org later (M15).
 */
export const LEGAL_ENTITY_NAME: string =
  import.meta.env.VITE_LEGAL_ENTITY_NAME ?? 'PMO Portal';

export const DOMAIN: string =
  import.meta.env.VITE_LEGAL_DOMAIN ?? 'pmoportal.app';

export const CONTACT_EMAIL: string =
  import.meta.env.VITE_LEGAL_CONTACT_EMAIL ?? 'support@pmoportal.app';

/** E.164 WhatsApp support number (e.g. "6281234567890"). Empty → Help omitted. */
export const HELP_WHATSAPP: string =
  import.meta.env.VITE_HELP_WHATSAPP ?? '';

/** Hosting location for the data-residency disclosure (per-client Supabase Cloud Pro). */
export const HOSTING_LOCATION: string =
  import.meta.env.VITE_HOSTING_LOCATION ?? 'Singapore';

/**
 * The wa.me Help URL. Empty when HELP_WHATSAPP is unset (FR-LEG-010). Consumers
 * MUST check truthiness before rendering any Help affordance so a broken
 * `wa.me/` link never renders.
 */
export const HELP_URL: string = HELP_WHATSAPP ? `https://wa.me/${HELP_WHATSAPP}` : '';
```

**File:** `pmo-portal/src/vite-env.d.ts` (EDIT — append the 5 keys inside the existing `interface ImportMetaEnv`)
```ts
  readonly VITE_APP_ENV?: string;
  // Legal config seam (FR-LEG-006/007) — presentable defaults in src/lib/legalConfig.ts
  readonly VITE_LEGAL_ENTITY_NAME?: string;
  readonly VITE_LEGAL_DOMAIN?: string;
  readonly VITE_LEGAL_CONTACT_EMAIL?: string;
  readonly VITE_HELP_WHATSAPP?: string;
  readonly VITE_HOSTING_LOCATION?: string;
}
```
**Verify (GREEN):** `cd pmo-portal && npx vitest run src/lib/legalConfig.test.ts && npm run typecheck` → 5 passed, typecheck clean.

---

## SLICE 2 — Shared `LegalPageLayout` + Terms + Privacy + routes + RTL tests

> Slices build in order; Slice 2 depends on Slice 1 (pages import `legalConfig`). The page tests **mock** `legalConfig` (fixed values → deterministic assertions) and **mock** `useAuth` (control `session` for the auth-aware back link). The real `legalConfig` module is unit-tested only in Slice 1; consumers mock it — the standard seam pattern.

### Task 2.1 — Write `Terms.test.tsx` (RED) — AC-LEG-001/004/006/009-012/027-033/035
**File:** `pmo-portal/pages/Terms.test.tsx` (NEW)
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Fixed config → deterministic assertions (AC-LEG-006/034). Mocked so the page
// test is independent of env; the real module is proven in legalConfig.test.ts.
const mockConfig = vi.hoisted(() => ({
  LEGAL_ENTITY_NAME: 'Acme Legal Test Co',
  DOMAIN: 'acme.test.example',
  CONTACT_EMAIL: 'legal@acme.test.example',
  HELP_WHATSAPP: '6281234567890',
  HOSTING_LOCATION: 'Jakarta',
  HELP_URL: 'https://wa.me/6281234567890',
}));
vi.mock('@/src/lib/legalConfig', () => mockConfig);

// Control session for the auth-aware back link (AC-LEG-030).
const mockAuth = vi.hoisted(() => ({ session: null as object | null }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ session: mockAuth.session }) }));

import Terms from './Terms';

function renderTerms() {
  return render(
    <MemoryRouter>
      <Terms />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockAuth.session = null; // unauthenticated primary audience
});

describe('Terms page', () => {
  it('AC-LEG-001: renders the bare Terms page — title present, no AppShell chrome', () => {
    renderTerms();
    expect(screen.getByRole('heading', { level: 1, name: /terms of service/i })).toBeInTheDocument();
    // Bare public page (FR-LEG-003): no rail nav landmark, no ContextBar banner landmark.
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByRole('banner')).toBeNull();
  });

  it('AC-LEG-004 / AC-LEG-027 / AC-LEG-009: one h1 (page-title token) + 8 h2 section headings', () => {
    renderTerms();
    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    // page-title token = 24px / 700 / -0.02em (DESIGN.md §3).
    expect(h1s[0].className).toMatch(/text-\[24px\]/);
    expect(h1s[0].className).toMatch(/font-bold/);
    expect(h1s[0].className).toMatch(/tracking-\[-0\.02em\]/);

    const h2Texts = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent ?? '');
    [
      'Acceptance of Terms', 'Services', 'User Responsibilities', 'Data Ownership',
      'Confidentiality', 'Limitation of Liability', 'Term and Termination', 'Governing Law',
    ].forEach((t) => expect(h2Texts).toContain(t));
  });

  it('AC-LEG-006: renders config entity/domain/contact email; no bracket placeholders', () => {
    renderTerms();
    expect(screen.getByText(/Acme Legal Test Co/)).toBeInTheDocument();
    expect(screen.getByText(/acme\.test\.example/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /legal@acme\.test\.example/i })).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toMatch(/\[(LEGAL-ENTITY|DOMAIN|CONTACT_EMAIL|HOSTING)\]/);
  });

  it('AC-LEG-010: Services section references the MSA / master subscription agreement', () => {
    renderTerms();
    const heading = screen.getByRole('heading', { level: 2, name: /^Services$/ });
    const section = heading.closest('section') ?? heading.parentElement!;
    expect(within(section).getByText(/master subscription|MSA/i)).toBeInTheDocument();
  });

  it('AC-LEG-011: Data Ownership affirms client ownership + limited license', () => {
    renderTerms();
    const heading = screen.getByRole('heading', { level: 2, name: /Data Ownership/ });
    const section = heading.closest('section') ?? heading.parentElement!;
    const text = section.textContent ?? '';
    expect(text).toMatch(/own/i);
    expect(text).toMatch(/license necessary to operate/i);
  });

  it('AC-LEG-012: Term and Termination includes initial / auto-renewal / convenience / cause', () => {
    renderTerms();
    const heading = screen.getByRole('heading', { level: 2, name: /Term and Termination/ });
    const section = heading.closest('section') ?? heading.parentElement!;
    const text = section.textContent ?? '';
    expect(text).toMatch(/Initial term/i);
    expect(text).toMatch(/Auto-renewal/i);
    expect(text).toMatch(/Termination for convenience/i);
    expect(text).toMatch(/Termination for cause/i);
  });

  it('AC-LEG-030: unauthenticated → "Back to sign in" → /login; authenticated → "Back to app" → /', () => {
    const { unmount } = renderTerms();
    expect(screen.getByRole('link', { name: /back to sign in/i })).toHaveAttribute('href', '/login');
    unmount();

    mockAuth.session = { access_token: 'x' } as object; // truthy → authed
    renderTerms();
    expect(screen.getByRole('link', { name: /back to app/i })).toHaveAttribute('href', '/');
    mockAuth.session = null;
  });

  it('AC-LEG-031: cross-links Privacy + Help (wa.me, new tab) + the auth-aware back link', () => {
    renderTerms();
    expect(screen.getByRole('link', { name: /^Privacy$/ })).toHaveAttribute('href', '/privacy');
    const help = screen.getByRole('link', { name: /contact support via whatsapp/i });
    expect(help).toHaveAttribute('href', 'https://wa.me/6281234567890');
    expect(help).toHaveAttribute('target', '_blank');
    expect(help).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('link', { name: /back to sign in/i })).toBeInTheDocument();
  });

  it('AC-LEG-028: links have descriptive labels (no "click here"); Help has the required aria-label', () => {
    renderTerms();
    const texts = screen.getAllByRole('link').map((a) => a.textContent ?? '');
    expect(texts.some((t) => /click here/i.test(t))).toBe(false);
    expect(screen.getByRole('link', { name: /contact support via whatsapp/i })).toBeInTheDocument();
  });

  it('AC-LEG-029: foreground uses the text-foreground token', () => {
    const { container } = renderTerms();
    expect(container.querySelector('.text-foreground')).not.toBeNull();
  });

  it('AC-LEG-032: exactly one <main> landmark with id="main"', () => {
    renderTerms();
    const mains = document.querySelectorAll('main');
    expect(mains).toHaveLength(1);
    expect(mains[0]).toHaveAttribute('id', 'main');
  });

  it('AC-LEG-033: a "Skip to main content" link targets #main', () => {
    renderTerms();
    expect(screen.getByRole('link', { name: /skip to main content/i })).toHaveAttribute('href', '#main');
  });

  it('AC-LEG-035: deterministic render — same config → byte-identical markup; no date-derived text', () => {
    const a = renderTerms();
    const htmlA = document.body.innerHTML;
    a.unmount();
    const b = renderTerms();
    const htmlB = document.body.innerHTML;
    b.unmount();
    expect(htmlA).toBe(htmlB);
    expect(htmlA).not.toMatch(/last updated|effective (date|today)/i);
  });
});
```
**Verify (RED):** `cd pmo-portal && npx vitest run pages/Terms.test.tsx` → fails (`Failed to resolve import "./Terms"`).

### Task 2.2 — Write `LegalPageLayout.tsx` (the shared chrome) — enables Task 2.3 GREEN
**File:** `pmo-portal/src/components/legal/LegalPageLayout.tsx` (NEW)
```tsx
import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/src/auth/useAuth';
import { HELP_URL } from '@/src/lib/legalConfig';

/**
 * Shared chrome for the public legal pages (FR-LEG-003/004/005/024/030/031,
 * NFR-LEG-003, AC-LEG-027..033). Renders OUTSIDE <Shell>, so it owns its own
 * <main id="main"> landmark + "Skip to main content" link — mirroring the
 * in-shell pattern at AppShell.tsx:142-145,167-168 — because the bare public
 * page cannot inherit the shell's <main> (M10).
 *
 * DESIGN.md tokens: page-title (h1 24/700/-0.02em), heading (h2 20/700/-0.01em),
 * body (14/1.45), overline (11/600/0.06em). Calm control surface: content on the
 * tinted secondary ground, hairline border, muted-foreground secondary text —
 * no shadows (Flat-By-Default). Links use text-primary-text (the AA blue token,
 * index.css:46) — NOT text-primary (the action fill, sub-AA on dark per DESIGN.md).
 */
export interface LegalPageLayoutProps {
  eyebrow?: string;
  title: string;
  /** Drives the sibling cross-link: terms→Privacy, privacy→Terms. */
  variant: 'terms' | 'privacy';
  children: React.ReactNode;
}

export const LegalPageLayout: React.FC<LegalPageLayoutProps> = ({
  eyebrow = 'Legal',
  title,
  variant,
  children,
}) => {
  // Auth-aware back link (FR-LEG-005, AC-LEG-030). session===null → unauthed
  // primary audience → /login (RequireAuth bounces / → /login); session present → /.
  // AuthProvider mounts at the App root above the router, so this resolves on both.
  const { session } = useAuth();
  const back = session
    ? { label: 'Back to app', to: '/' }
    : { label: 'Back to sign in', to: '/login' };
  const crossLink =
    variant === 'terms' ? { label: 'Privacy', to: '/privacy' } : { label: 'Terms', to: '/terms' };

  return (
    <div className="min-h-[100dvh] bg-secondary/35">
      {/* Skip link — mirrors AppShell.tsx:142-145 (AC-LEG-033). */}
      <a
        href="#main"
        className="sr-only z-[1000] rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground focus:not-sr-only focus:absolute focus:left-3 focus:top-3"
      >
        Skip to main content
      </a>

      <main
        id="main"
        tabIndex={-1}
        className="mx-auto max-w-3xl px-5 pb-16 pt-10 outline-none max-[921px]:px-4 max-[921px]:pt-6"
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {eyebrow}
        </p>

        {/* Page title — page-title token (24/700/-0.02em); the single h1 (AC-LEG-004/027). */}
        <h1 className="mt-1 text-[24px] font-bold leading-[1.2] tracking-[-0.02em] text-foreground">
          {title}
        </h1>

        {/* Top navigation row (FR-LEG-024/030/031). A <div>, not <nav>, so the bare
            page has no nav landmark — "AppShell does not render" (AC-LEG-001/002) is
            unambiguous and the icon/overflow gates see a clean structure. */}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
          <Link to={back.to} className="font-medium text-primary-text hover:underline">
            {back.label}
          </Link>
          <span aria-hidden className="text-muted-foreground">·</span>
          <Link to={crossLink.to} className="font-medium text-primary-text hover:underline">
            {crossLink.label}
          </Link>
          {HELP_URL && (
            <>
              <span aria-hidden className="text-muted-foreground">·</span>
              <a
                href={HELP_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Contact support via WhatsApp"
                className="font-medium text-primary-text hover:underline"
              >
                Help
              </a>
            </>
          )}
        </div>

        <hr className="my-6 border-border" />

        {/* Body/prose container (14/1.6 for readability). Children = the <h2> sections. */}
        <div className="space-y-7 text-[14px] leading-[1.6] text-foreground">{children}</div>
      </main>
    </div>
  );
};

/** Shared section wrapper: h2 (heading token 20/700/-0.01em) + prose body. */
export const LegalSection: React.FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <section className="space-y-2">
    <h2 className="text-[20px] font-bold leading-[1.25] tracking-[-0.01em] text-foreground">
      {title}
    </h2>
    {children}
  </section>
);
```
**Verify:** `cd pmo-portal && npm run typecheck` → clean (no test yet; consumed by Task 2.3).

### Task 2.3 — Write `Terms.tsx` (GREEN — Terms.test passes) — AC-LEG-001/004/006/009-012
**File:** `pmo-portal/pages/Terms.tsx` (NEW)
```tsx
import React from 'react';
import { LegalPageLayout, LegalSection } from '@/src/components/legal/LegalPageLayout';
import { LEGAL_ENTITY_NAME, DOMAIN, CONTACT_EMAIL } from '@/src/lib/legalConfig';

/**
 * Public Terms of Service page (FR-LEG-001/003/008/011-014, AC-LEG-001/006/009-012).
 * Bare public page for everyone — no AppShell (FR-LEG-003). Template-grade section
 * outlines with the spec's required clauses as real prose stubs; counsel refines
 * the actual language later (spec §8 deviation 1). Config values are interpolated
 * so no bracket placeholder ever renders (FR-LEG-008).
 */
const Terms: React.FC = () => (
  <LegalPageLayout eyebrow="Legal" title="Terms of Service" variant="terms">
    <LegalSection title="Acceptance of Terms">
      <p className="text-muted-foreground">
        By accessing or using {LEGAL_ENTITY_NAME} ({DOMAIN}), you agree to be bound by these Terms
        of Service. If you do not agree, do not access or use the service.
      </p>
    </LegalSection>

    <LegalSection title="Services">
      <p className="text-muted-foreground">
        {LEGAL_ENTITY_NAME} provides a contract- and project-management platform for
        project-based organizations. Your use of the service is governed by the master subscription
        agreement (MSA) between you and {LEGAL_ENTITY_NAME}, which is the controlling commercial
        contract; these Terms address use of the platform itself.
      </p>
      <p className="text-muted-foreground">
        For questions about your subscription, contact{' '}
        <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary-text hover:underline">
          {CONTACT_EMAIL}
        </a>
        .
      </p>
    </LegalSection>

    <LegalSection title="User Responsibilities">
      <p className="text-muted-foreground">
        You are responsible for the accuracy of the data you enter, for keeping your credentials
        secure, and for using the service in compliance with applicable law and these Terms.
      </p>
    </LegalSection>

    <LegalSection title="Data Ownership">
      <p className="text-muted-foreground">
        You (the client) own all data you submit to the service. You grant {LEGAL_ENTITY_NAME} only
        the license necessary to operate and provide the service to you. {LEGAL_ENTITY_NAME} does
        not claim ownership of your data.
      </p>
    </LegalSection>

    <LegalSection title="Confidentiality">
      <p className="text-muted-foreground">
        Each party agrees to keep the other party&rsquo;s confidential information confidential and
        to use it solely to perform under these Terms and the MSA.
      </p>
    </LegalSection>

    <LegalSection title="Limitation of Liability">
      <p className="text-muted-foreground">
        To the maximum extent permitted by law, {LEGAL_ENTITY_NAME}&rsquo;s liability under these
        Terms is limited to the fees paid for the service in the twelve (12) months preceding the
        claim. Neither party is liable for indirect or consequential damages.
      </p>
    </LegalSection>

    <LegalSection title="Term and Termination">
      <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
        <li><strong>Initial term:</strong> the subscription term set out in the MSA.</li>
        <li><strong>Auto-renewal:</strong> the term renews automatically for successive periods unless either party gives notice of non-renewal.</li>
        <li><strong>Termination for convenience:</strong> either party may terminate on the notice period set out in the MSA.</li>
        <li><strong>Termination for cause:</strong> either party may terminate immediately on material breach by the other party, subject to any cure period in the MSA.</li>
      </ul>
    </LegalSection>

    {/* Governing Law is HEADING-ONLY (FR-LEG-011, M12): the governing-law clause
        (Indonesia vs BANI arbitration vs district court) is a live counsel question
        (docs/legal/2026-07-04-msa-brief.md §8). The line below is a deferral marker,
        NOT a legal clause — clause text lands via counsel, not in code. */}
    <LegalSection title="Governing Law">
      <p className="text-muted-foreground italic">
        Governing law and dispute-resolution terms to be confirmed.
      </p>
    </LegalSection>
  </LegalPageLayout>
);

export default Terms;
```
**Verify (GREEN):** `cd pmo-portal && npx vitest run pages/Terms.test.tsx` → 13 passed.

### Task 2.4 — Write `Privacy.test.tsx` (RED) — AC-LEG-002/007/013-020/027-033/035
**File:** `pmo-portal/pages/Privacy.test.tsx` (NEW)
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// HOSTING_LOCATION mocked to 'Singapore' so AC-LEG-015 reads naturally.
const mockConfig = vi.hoisted(() => ({
  LEGAL_ENTITY_NAME: 'Acme Legal Test Co',
  DOMAIN: 'acme.test.example',
  CONTACT_EMAIL: 'legal@acme.test.example',
  HELP_WHATSAPP: '6281234567890',
  HOSTING_LOCATION: 'Singapore',
  HELP_URL: 'https://wa.me/6281234567890',
}));
vi.mock('@/src/lib/legalConfig', () => mockConfig);

const mockAuth = vi.hoisted(() => ({ session: null as object | null }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ session: mockAuth.session }) }));

import Privacy from './Privacy';

function renderPrivacy() {
  return render(
    <MemoryRouter>
      <Privacy />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockAuth.session = null;
});

describe('Privacy page', () => {
  it('AC-LEG-002: renders the bare Privacy page — title present, no AppShell chrome', () => {
    renderPrivacy();
    expect(screen.getByRole('heading', { level: 1, name: /privacy policy/i })).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByRole('banner')).toBeNull();
  });

  it('AC-LEG-013 / AC-LEG-027: one h1 + all 9 section headings as h2', () => {
    renderPrivacy();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const h2Texts = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent ?? '');
    [
      'Data We Collect', 'Data Ownership', 'How We Use Your Data', 'AI Processing Disclosure',
      'Data Location', 'Data Export', 'Data Retention and Deletion', 'Confidentiality and Security',
      'Contact Us',
    ].forEach((t) => expect(h2Texts).toContain(t));
  });

  it('AC-LEG-007: renders config entity/domain/contact email/hosting location; no brackets', () => {
    renderPrivacy();
    expect(screen.getByText(/Acme Legal Test Co/)).toBeInTheDocument();
    expect(screen.getByText(/Singapore/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /legal@acme\.test\.example/i })).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toMatch(/\[(LEGAL-ENTITY|DOMAIN|CONTACT_EMAIL|HOSTING)\]/);
  });

  it('AC-LEG-014: Data Ownership affirms client ownership + limited license', () => {
    const heading = screen.getByRole('heading' as const, { level: 2, name: /Data Ownership/ });
    const section = heading.closest('section') ?? heading.parentElement!;
    const text = section.textContent ?? '';
    expect(text).toMatch(/own/i);
    expect(text).toMatch(/license (necessary|needed) to operate/i);
  });

  it('AC-LEG-015: Data Location states the hosting location (Singapore)', () => {
    const heading = screen.getByRole('heading' as const, { level: 2, name: /Data Location/ });
    const section = heading.closest('section') ?? heading.parentElement!;
    expect(section.textContent ?? '').toMatch(/Singapore/);
  });

  it('AC-LEG-016: Data Export — CSV/XLSX anytime + full export within 30 days on termination', () => {
    const heading = screen.getByRole('heading' as const, { level: 2, name: /Data Export/ });
    const section = heading.closest('section') ?? heading.parentElement!;
    const text = section.textContent ?? '';
    expect(text).toMatch(/CSV|XLSX/i);
    expect(text).toMatch(/30 days/i);
  });

  it('AC-LEG-017: Data Retention and Deletion — deleted within 60–90 days', () => {
    const heading = screen.getByRole('heading' as const, { level: 2, name: /Data Retention and Deletion/ });
    const section = heading.closest('section') ?? heading.parentElement!;
    expect(section.textContent ?? '').toMatch(/60.?90 days/i);
  });

  it('AC-LEG-018: AI Processing Disclosure matches MSA brief §4 (OpenRouter, no training, no staff reading)', () => {
    const heading = screen.getByRole('heading' as const, { level: 2, name: /AI Processing Disclosure/ });
    const section = heading.closest('section') ?? heading.parentElement!;
    const text = section.textContent ?? '';
    expect(text).toMatch(/OpenRouter|third-party LLM/i);
    expect(text).toMatch(/not.*train/i);
    expect(text).toMatch(/do not read|aggregates only/i);
  });

  it('AC-LEG-019: Confidentiality and Security — mutual confidentiality, daily backups, per-client isolation', () => {
    const heading = screen.getByRole('heading' as const, { level: 2, name: /Confidentiality and Security/ });
    const section = heading.closest('section') ?? heading.parentElement!;
    const text = section.textContent ?? '';
    expect(text).toMatch(/confidential/i);
    expect(text).toMatch(/daily backup/i);
    expect(text).toMatch(/isolat/i);
  });

  it('AC-LEG-020: Contact Us displays contact email + WhatsApp help link', () => {
    const heading = screen.getByRole('heading' as const, { level: 2, name: /Contact Us/ });
    const section = heading.closest('section') ?? heading.parentElement!;
    expect(within(section).getByRole('link', { name: /legal@acme\.test\.example/i })).toBeInTheDocument();
    const help = within(section).getByRole('link', { name: /contact support via whatsapp/i });
    expect(help).toHaveAttribute('href', 'https://wa.me/6281234567890');
  });

  // Shared-layout ACs (spec lists Privacy.test.tsx as a co-owner; layout is shared
  // with Terms, so these re-assert the contract for this page specifically).
  it('AC-LEG-030: unauthenticated back link → /login', () => {
    renderPrivacy();
    expect(screen.getByRole('link', { name: /back to sign in/i })).toHaveAttribute('href', '/login');
  });

  it('AC-LEG-031: cross-links Terms + Help (wa.me, new tab)', () => {
    renderPrivacy();
    expect(screen.getByRole('link', { name: /^Terms$/ })).toHaveAttribute('href', '/terms');
    const help = screen.getByRole('link', { name: /contact support via whatsapp/i });
    expect(help).toHaveAttribute('target', '_blank');
  });

  it('AC-LEG-032 / AC-LEG-033: one <main id="main"> + skip link → #main', () => {
    renderPrivacy();
    const mains = document.querySelectorAll('main');
    expect(mains).toHaveLength(1);
    expect(mains[0]).toHaveAttribute('id', 'main');
    expect(screen.getByRole('link', { name: /skip to main content/i })).toHaveAttribute('href', '#main');
  });

  it('AC-LEG-035: deterministic render — same config → identical markup', () => {
    const a = renderPrivacy();
    const htmlA = document.body.innerHTML;
    a.unmount();
    const b = renderPrivacy();
    const htmlB = document.body.innerHTML;
    b.unmount();
    expect(htmlA).toBe(htmlB);
  });
});

// screen.getByRole typing helper is fine without the cast, but keep the file lint-clean.
void within;
```
**Verify (RED):** `cd pmo-portal && npx vitest run pages/Privacy.test.tsx` → fails (`Failed to resolve import "./Privacy"`).

> Note on the `as const` casts in `getByRole('heading' as const, …)`: harmless and keeps tsc happy if the rtl type narrows on the literal. If the project's RTL typings accept a plain `'heading'` string without the cast, the implementer may drop the casts — they are not load-bearing. (The `void within;` line is only to satisfy the unused-import lint if any helper ends up unused; remove it if `within` is used.)

### Task 2.5 — Write `Privacy.tsx` (GREEN) — AC-LEG-002/007/013-020
**File:** `pmo-portal/pages/Privacy.tsx` (NEW)
```tsx
import React from 'react';
import { LegalPageLayout, LegalSection } from '@/src/components/legal/LegalPageLayout';
import {
  LEGAL_ENTITY_NAME,
  DOMAIN,
  CONTACT_EMAIL,
  HOSTING_LOCATION,
  HELP_URL,
} from '@/src/lib/legalConfig';

/**
 * Public Privacy Policy page (FR-LEG-002/003/009/015-022, AC-LEG-002/007/013-020).
 * Bare public page for everyone — no AppShell. Template-grade; counsel refines.
 */
const Privacy: React.FC = () => (
  <LegalPageLayout eyebrow="Legal" title="Privacy Policy" variant="privacy">
    <LegalSection title="Data We Collect">
      <p className="text-muted-foreground">
        {LEGAL_ENTITY_NAME} ({DOMAIN}) collects the data you enter to operate the service — account
        and profile information, and the business records (projects, companies, contacts, financial
        and operational data) you choose to store.
      </p>
    </LegalSection>

    <LegalSection title="Data Ownership">
      <p className="text-muted-foreground">
        You (the client) own your data. {LEGAL_ENTITY_NAME} receives only the license necessary to
        operate and provide the service to you, and does not claim ownership of your data.
      </p>
    </LegalSection>

    <LegalSection title="How We Use Your Data">
      <p className="text-muted-foreground">
        We use your data to provide, maintain and improve the service, to communicate with you about
        your account, and to provide the features you enable. We do not sell your data.
      </p>
    </LegalSection>

    <LegalSection title="AI Processing Disclosure">
      <p className="text-muted-foreground">
        When you use the Assistant, your prompts and the minimum necessary data context are sent to
        third-party large-language-model providers via OpenRouter to generate a response. Your client
        data is not used to train models. {LEGAL_ENTITY_NAME} staff do not read the contents of
        Assistant conversations; only aggregates are processed for support and reliability.
      </p>
    </LegalSection>

    <LegalSection title="Data Location">
      <p className="text-muted-foreground">
        Your data is hosted on a per-client Supabase Cloud Pro environment. The hosting location for
        this deployment is {HOSTING_LOCATION} (configurable per client per ADR-0047).
      </p>
    </LegalSection>

    <LegalSection title="Data Export">
      <p className="text-muted-foreground">
        You can export your data at any time using the in-product CSV/XLSX export. On termination of
        the service, you may request a full export of your data, which we will provide within 30 days.
      </p>
    </LegalSection>

    <LegalSection title="Data Retention and Deletion">
      <p className="text-muted-foreground">
        After termination, client data is deleted within 60–90 days. You may request earlier
        deletion of specific data at any time.
      </p>
    </LegalSection>

    <LegalSection title="Confidentiality and Security">
      <p className="text-muted-foreground">
        Each party maintains mutual confidentiality of the other&rsquo;s non-public information. We
        protect your data with daily backups and per-client environment isolation.
      </p>
    </LegalSection>

    <LegalSection title="Contact Us">
      <p className="text-muted-foreground">
        For privacy questions, email{' '}
        <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary-text hover:underline">
          {CONTACT_EMAIL}
        </a>
        .
      </p>
      {HELP_URL && (
        <p className="text-muted-foreground">
          For support,{' '}
          <a
            href={HELP_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Contact support via WhatsApp"
            className="text-primary-text hover:underline"
          >
            contact us on WhatsApp
          </a>
          .
        </p>
      )}
    </LegalSection>
  </LegalPageLayout>
);

export default Privacy;
```
**Verify (GREEN):** `cd pmo-portal && npx vitest run pages/Privacy.test.tsx` → all green.

### Task 2.6 — Wire `/terms` + `/privacy` routes in `App.tsx` (outside RequireAuth)
**File:** `pmo-portal/App.tsx` (EDIT)

(1) Add eager imports beside the existing `LoginPage` import (top of file, after the `LoginPage` import line):
```ts
import LoginPage from '@/src/auth/LoginPage';
import TermsPage from './pages/Terms';
import PrivacyPage from './pages/Privacy';
```
(2) In the root `<Routes>` (inside `BrowserRouter > AnalyticsProvider`), add the two routes as siblings of `/login`, before the `RequireAuth` wrapper:
```tsx
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/terms" element={<TermsPage />} />
              <Route path="/privacy" element={<PrivacyPage />} />
              <Route element={<RequireAuth />}>
                <Route path="/*" element={<Shell />} />
              </Route>
            </Routes>
```
**Why eager:** matches `/login` (also eager) and avoids introducing a `<Suspense>` boundary the root routes don't have; the legal pages are small static TSX with no data fetching — no reason to code-split.
**Verify:** `cd pmo-portal && npm run typecheck && npx vitest run pages/Terms.test.tsx pages/Privacy.test.tsx` → clean + green. (Routes themselves are exercised end-to-end by the Slice-6 e2e; the unit tests render the page components directly.)

---

## SLICE 3 — Entry points: login footer + mobile menu + desktop Help icon-link

### Task 3.1 — Extend `LoginPage.test.tsx` (RED) — AC-LEG-021
**File:** `pmo-portal/src/auth/LoginPage.test.tsx` (EDIT)

(1) Add a `legalConfig` mock to the existing hoisted-mocks block (so the Help link renders deterministically). Place with the other `vi.mock` calls near the top:
```ts
vi.mock('@/src/lib/legalConfig', () => ({
  LEGAL_ENTITY_NAME: 'PMO Portal',
  DOMAIN: 'pmoportal.app',
  CONTACT_EMAIL: 'support@pmoportal.app',
  HELP_WHATSAPP: '6281234567890',
  HOSTING_LOCATION: 'Singapore',
  HELP_URL: 'https://wa.me/6281234567890',
}));
```
(2) Add `within` to the existing `@testing-library/react` import and append this test inside the existing `describe('LoginPage', …)` block:
```ts
  it('AC-LEG-021: footer has Terms, Privacy, and Help links', () => {
    renderLogin();
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByRole('link', { name: /^terms$/i })).toHaveAttribute('href', '/terms');
    expect(within(footer).getByRole('link', { name: /^privacy$/i })).toHaveAttribute('href', '/privacy');
    const help = within(footer).getByRole('link', { name: /contact support via whatsapp/i });
    expect(help).toHaveAttribute('href', 'https://wa.me/6281234567890');
    expect(help).toHaveAttribute('target', '_blank');
    expect(help).toHaveAttribute('rel', 'noopener noreferrer');
  });
```
**Verify (RED):** `cd pmo-portal && npx vitest run src/auth/LoginPage.test.tsx` → the new test fails (no footer yet).

### Task 3.2 — Edit `LoginPage.tsx` — add the footer (GREEN) — FR-LEG-023, AC-LEG-021
**File:** `pmo-portal/src/auth/LoginPage.tsx` (EDIT)

(1) Imports: change `import { useNavigate } from 'react-router-dom';` → `import { Link, useNavigate } from 'react-router-dom';` and add `import { HELP_URL } from '@/src/lib/legalConfig';` with the other `@/src/lib/...` imports.

(2) Inside the outer `<div className="w-full max-w-sm">`, immediately AFTER the closing `</Card>` and BEFORE the closing `</div>` of that wrapper, add:
```tsx
        {/* Footer — Terms · Privacy · Help (FR-LEG-023, AC-LEG-021).
            Help opens the wa.me URL in a new tab; omitted entirely when HELP_WHATSAPP
            is unset so no broken link renders (FR-LEG-010). */}
        <footer className="mt-5 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-[12px] text-muted-foreground">
          <Link to="/terms" className="font-medium text-primary-text hover:underline">
            Terms
          </Link>
          <span aria-hidden>·</span>
          <Link to="/privacy" className="font-medium text-primary-text hover:underline">
            Privacy
          </Link>
          {HELP_URL && (
            <>
              <span aria-hidden>·</span>
              <a
                href={HELP_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Contact support via WhatsApp"
                className="font-medium text-primary-text hover:underline"
              >
                Help
              </a>
            </>
          )}
        </footer>
```
**Verify (GREEN):** `cd pmo-portal && npx vitest run src/auth/LoginPage.test.tsx` → all green (including the new AC-LEG-021 test).

### Task 3.3 — Write `ContextBar.test.tsx` (RED) — AC-LEG-023/025
**File:** `pmo-portal/src/components/shell/ContextBar.test.tsx` (NEW)
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

// Mutable config so the "Help omitted when empty" leg can flip HELP_URL.
const mockConfig = vi.hoisted(() => ({ HELP_URL: 'https://wa.me/6281234567890' }));
vi.mock('@/src/lib/legalConfig', () => ({
  HELP_URL: mockConfig.HELP_URL,
  HELP_WHATSAPP: '6281234567890',
}));

const mockAuth = vi.hoisted(() => ({
  currentUser: { full_name: 'Test User' },
  signOut: vi.fn(),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => mockAuth }));

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: 'Engineer', canImpersonate: false, viewAs: () => {} }),
}));

// NotificationBell is feature-gated off so it doesn't render.
vi.mock('@/src/lib/features', () => ({ isFeatureEnabled: () => false }));

import { ContextBar } from '@/src/components/shell/ContextBar';

function renderBar() {
  return render(
    <MemoryRouter>
      <ContextBar breadcrumb={[]} onOpenPalette={() => {}} onToggleRail={() => {}} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockConfig.HELP_URL = 'https://wa.me/6281234567890';
});

describe('ContextBar legal entry points', () => {
  it('AC-LEG-025: desktop cluster has ONE inline Help icon-link, correct attrs, NO Terms/Privacy', () => {
    renderBar();
    const cluster = screen.getByTestId('desktop-account-cluster');
    const help = within(cluster).getByRole('link', { name: /contact support via whatsapp/i });
    expect(help).toHaveAttribute('href', 'https://wa.me/6281234567890');
    expect(help).toHaveAttribute('target', '_blank');
    expect(help).toHaveAttribute('rel', 'noopener noreferrer');
    // No Terms/Privacy on the desktop chrome (FR-LEG-028).
    expect(within(cluster).queryByRole('link', { name: /^terms$/i })).toBeNull();
    expect(within(cluster).queryByRole('link', { name: /^privacy$/i })).toBeNull();
    // Exactly one Help link in the desktop cluster.
    expect(within(cluster).getAllByRole('link', { name: /contact support via whatsapp/i })).toHaveLength(1);
  });

  it('AC-LEG-023: mobile account menu includes Terms, Privacy, Help', async () => {
    renderBar();
    const menu = screen.getByTestId('mobile-account-menu');
    // Menu closed initially — open via the avatar trigger.
    await userEvent.click(screen.getByRole('button', { name: /account menu/i }));
    expect(within(menu).getByRole('link', { name: /^terms$/i })).toHaveAttribute('href', '/terms');
    expect(within(menu).getByRole('link', { name: /^privacy$/i })).toHaveAttribute('href', '/privacy');
    const help = within(menu).getByRole('link', { name: /contact support via whatsapp/i });
    expect(help).toHaveAttribute('href', 'https://wa.me/6281234567890');
    expect(help).toHaveAttribute('target', '_blank');
  });

  it('AC-LEG-010/FR-LEG-028: desktop Help + mobile Help omitted when HELP_URL empty', async () => {
    vi.resetModules();
    vi.doMock('@/src/lib/legalConfig', () => ({ HELP_URL: '', HELP_WHATSAPP: '' }));
    vi.doMock('@/src/auth/useAuth', () => ({ useAuth: () => mockAuth }));
    vi.doMock('@/src/auth/impersonation', () => ({
      useEffectiveRole: () => ({ effectiveRole: 'Engineer', canImpersonate: false, viewAs: () => {} }),
    }));
    vi.doMock('@/src/lib/features', () => ({ isFeatureEnabled: () => false }));
    const mod = await import('@/src/components/shell/ContextBar');
    render(
      <MemoryRouter>
        <mod.ContextBar breadcrumb={[]} onOpenPalette={() => {}} onToggleRail={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link', { name: /contact support via whatsapp/i })).toBeNull();
    vi.resetModules(); // restore default mocks for any later tests
  });
});
```
> **Why mock `Breadcrumb`/`ThemeToggle` are NOT mocked:** they render fine in jsdom (Breadcrumb with `[]` parts renders nothing problematic; ThemeToggle uses `localStorage`, which jsdom provides). If a future change makes either throw in jsdom, mock it as `vi.mock('@/src/components/shell/ThemeToggle', () => ({ ThemeToggle: () => null }))` — the legal-entry-point tests don't assert on them.

**Verify (RED):** `cd pmo-portal && npx vitest run src/components/shell/ContextBar.test.tsx` → fails (no `data-testid="desktop-account-cluster"` / `mobile-account-menu`; no legal entries yet).

### Task 3.4 — Edit `ContextBar.tsx` — desktop Help icon + mobile menu entries (GREEN) — FR-LEG-027/028, AC-LEG-023/025
**File:** `pmo-portal/src/components/shell/ContextBar.tsx` (EDIT)

(1) Imports: add to the existing `react-router-dom` import — change `import { useAuth } from '@/src/auth/useAuth';` line's neighborhood; specifically add at top with the other imports:
```ts
import { Link } from 'react-router-dom';
import { HELP_URL } from '@/src/lib/legalConfig';
```
(2) **Desktop cluster:** add `data-testid="desktop-account-cluster"` to the desktop wrapper and insert ONE Help icon-link immediately before the Sign out `<button>`:
```tsx
      {/* Desktop right-cluster (≥640px): role-switcher + user chip + Sign out, inline.
          On phones this whole cluster collapses behind the avatar menu below. */}
      <div data-testid="desktop-account-cluster" className="hidden items-center gap-3.5 sm:flex">
      {/* … existing canImpersonate block … */}
      {/* … existing user chip div … */}

      {/* FR-LEG-028 / AC-LEG-025: ONE inline Help icon-link (wa.me) next to Sign out.
          No new dropdown; no Terms/Privacy on desktop chrome (reachable via login
          footer, legal cross-links, direct URL). Omitted when HELP_WHATSAPP unset. */}
      {HELP_URL && (
        <a
          href={HELP_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Contact support via WhatsApp"
          className="touch-target inline-flex h-8 shrink-0 items-center justify-center rounded-lg border border-input bg-background px-2.5 text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-[17px]"
        >
          <Icon name="message" />
        </a>
      )}

      <button
        type="button"
        onClick={() => void signOut()}
        className="touch-target inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-lg border border-input bg-background px-3 text-[13px] font-medium text-foreground hover:bg-accent max-[921px]:px-2.5"
      >
        Sign out
      </button>
      </div>
```
(3) **Mobile account menu:** add `data-testid="mobile-account-menu"` to the mobile wrapper `<div>`, and insert a "Legal & support" group inside the `acctOpen && (...)` panel — after the `{canImpersonate && (…)}` block and before the final Sign-out separator/button:
```tsx
      <div data-testid="mobile-account-menu" className="relative sm:hidden" ref={acctRef}>
        {/* … avatar button … */}
        {acctOpen && (
          <div role="menu" className="…">
            {/* … user header … */}
            {/* … {canImpersonate && (…)} block … */}

            <div className="my-1 border-t border-border" />
            <div className="px-2.5 pt-1 pb-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Legal &amp; support
            </div>
            {/* FR-LEG-027 / AC-LEG-023: Terms / Privacy route links + Help (wa.me new tab). */}
            <Link
              to="/terms"
              role="menuitem"
              onClick={() => setAcctOpen(false)}
              className="flex h-9 w-full items-center rounded-md px-2.5 text-left text-[13.5px] hover:bg-accent"
            >
              Terms
            </Link>
            <Link
              to="/privacy"
              role="menuitem"
              onClick={() => setAcctOpen(false)}
              className="flex h-9 w-full items-center rounded-md px-2.5 text-left text-[13.5px] hover:bg-accent"
            >
              Privacy
            </Link>
            {HELP_URL && (
              <a
                href={HELP_URL}
                target="_blank"
                rel="noopener noreferrer"
                role="menuitem"
                aria-label="Contact support via WhatsApp"
                className="flex h-9 w-full items-center rounded-md px-2.5 text-left text-[13.5px] hover:bg-accent"
              >
                Help
              </a>
            )}

            <div className="my-1 border-t border-border" />
            {/* … existing Sign out menuitem … */}
          </div>
        )}
      </div>
```
**Verify (GREEN):** `cd pmo-portal && npx vitest run src/components/shell/ContextBar.test.tsx && npm run typecheck` → green + clean.

---

## SLICE 4 — ROUTES-array registration in BOTH gate files + the presence test

### Task 4.1 — Write `legal-route-registry.test.ts` (RED) — AC-LEG-026
**File:** `pmo-portal/src/lib/legal-route-registry.test.ts` (NEW)

(ESM-safe `__dirname` via `import.meta.url`; reads each gate file's `ROUTES` array block and asserts the two paths are present as `path:` entries.)
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const E2E_DIR = resolve(__dirname, '../../e2e');

const GATES = [
  'AC-MOBILE-OVERFLOW-001-no-horizontal-bleed.spec.ts',
  'AC-VISUAL-ICON-001-no-oversized-icons.spec.ts',
];

/** Slice the hand-maintained `const ROUTES = [ … ];` block from a gate file. */
function routesBlock(fileName: string): string {
  const src = readFileSync(resolve(E2E_DIR, fileName), 'utf8');
  const start = src.indexOf('const ROUTES');
  expect(start, `${fileName}: no ROUTES array found`).toBeGreaterThan(-1);
  const end = src.indexOf('];', start);
  expect(end, `${fileName}: ROUTES array not closed`).toBeGreaterThan(start);
  return src.slice(start, end + 2);
}

describe('AC-LEG-026 — legal routes present in both sweep ROUTES arrays', () => {
  for (const gate of GATES) {
    it(`${gate}: ROUTES contains /terms and /privacy`, () => {
      const block = routesBlock(gate);
      expect(block, `${gate}: missing /terms entry`).toMatch(/path:\s*'\/terms'/);
      expect(block, `${gate}: missing /privacy entry`).toMatch(/path:\s*'\/privacy'/);
    });
  }
});
```
**Verify (RED):** `cd pmo-portal && npx vitest run src/lib/legal-route-registry.test.ts` → fails (no `/terms`/`/privacy` in either array yet).

### Task 4.2 — Add `/terms` + `/privacy` to BOTH gate `ROUTES` arrays (GREEN) — FR-LEG-029, NFR-LEG-001
**File:** `pmo-portal/e2e/AC-MOBILE-OVERFLOW-001-no-horizontal-bleed.spec.ts` (EDIT) — append to the `ROUTES` array (after the `/administration` entry, before the closing `];`):
```ts
  { path: '/administration', label: 'administration' },
  // Legal pages (FR-LEG-029): public bare pages, swept at 390/360px for no-bleed.
  { path: '/terms', label: 'terms' },
  { path: '/privacy', label: 'privacy' },
];
```
**File:** `pmo-portal/e2e/AC-VISUAL-ICON-001-no-oversized-icons.spec.ts` (EDIT) — same append:
```ts
  { path: '/administration', label: 'administration' },
  // Legal pages (FR-LEG-029): swept at desktop + mobile for no oversized shared icons.
  { path: '/terms', label: 'terms' },
  { path: '/privacy', label: 'privacy' },
];
```
**Why safe:** both gates `signIn(page,'admin@acme.test')` then `page.goto(route.path)`. The public legal routes render their bare page regardless of auth (FR-LEG-003), so the signed-in admin sees the same bare page — no AppShell chrome, no rail, no ContextBar. The pages are simple prose/lists at `max-w-3xl` with responsive `px-4` gutters → no horizontal bleed, and they render zero shared `svg[viewBox="0 0 24 24"]` icons (links are text-only) → no oversized-icon regression. Both gates pass trivially on these routes.
**Verify (GREEN):** `cd pmo-portal && npx vitest run src/lib/legal-route-registry.test.ts` → 2 passed. (The gates themselves run in Slice 6's e2e pass / CI integration tier; `npm run verify` does not run Playwright.)

---

## SLICE 5 — `docs/environments.md` `VITE_LEGAL_*` provisioning line

### Task 5.1 — Add the legal-env provisioning block
**File:** `docs/environments.md` (EDIT) — in the "Frontend on Cloudflare Pages" → "Environment variables" list (immediately after the `VITE_ANALYTICS_ENABLED` bullet, before the "PostHog demo analytics flags" subsection), add:
```markdown
  - **Legal pages (set per client at provisioning, FR-LEG-006/007):** every value has a
    presentable default so an unset var never renders a bracket placeholder (I6).
    - `VITE_LEGAL_ENTITY_NAME` = the legal entity name shown on Terms/Privacy (default `PMO Portal`).
    - `VITE_LEGAL_DOMAIN` = the public domain (default `pmoportal.app`).
    - `VITE_LEGAL_CONTACT_EMAIL` = the contact/support email (default `support@pmoportal.app`).
    - `VITE_HELP_WHATSAPP` = E.164 WhatsApp support number, e.g. `6281234567890` (default empty → Help link omitted entirely, FR-LEG-010).
    - `VITE_HOSTING_LOCATION` = the data-residency location disclosed on Privacy (default `Singapore`; per-client per ADR-0047; staging is Sydney).
```
**Verify:** `grep -n "VITE_LEGAL_ENTITY_NAME" docs/environments.md` → one match in the env-vars list.

---

## SLICE 6 — E2E (Playwright) for the two cross-stack navigation ACs

> **Prerequisite (flag for the Director):** the e2e Help-legs (`AC-LEG-022`/`024`) require `VITE_HELP_WHATSAPP` to be set in the dev-server env (`npm run dev` reads `pmo-portal/.env.local`). Until the owner provides the real E.164 number (GTM item 8), set a **test** value (e.g. `6281234567890`) in `pmo-portal/.env.local` so the Help link renders and the popup-legs pass. The Terms/Privacy legs pass unconditionally. See **Open Questions** §6.

### Task 6.1 — `AC-LEG-022-login-footer.spec.ts` (E2E) — AC-LEG-022
**File:** `pmo-portal/e2e/AC-LEG-022-login-footer.spec.ts` (NEW)
```ts
import { test, expect } from '@playwright/test';

/**
 * AC-LEG-022 — login footer links navigate correctly (cross-stack: rendered footer
 * link → router navigation / new tab). The footer lives on /login (unauthed), so no
 * signIn is needed. Help-leg opens wa.me in a new tab and requires VITE_HELP_WHATSAPP
 * in the dev-server env (see docs/plans/2026-07-04-legal-pages.md Slice 6 prerequisite).
 */
test.describe('AC-LEG-022 login footer links navigate correctly', () => {
  test('AC-LEG-022 Terms / Privacy / Help from the login footer', async ({ page, context }) => {
    await page.goto('/login');
    const footer = page.getByRole('contentinfo');

    // Terms → /terms
    await footer.getByRole('link', { name: /^terms$/i }).click();
    await expect(page).toHaveURL(/\/terms$/);
    await expect(page.getByRole('heading', { level: 1, name: /terms of service/i })).toBeVisible();

    // Privacy → /privacy
    await page.goto('/login');
    await page.getByRole('contentinfo').getByRole('link', { name: /^privacy$/i }).click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.getByRole('heading', { level: 1, name: /privacy policy/i })).toBeVisible();

    // Help → wa.me in a new tab (target=_blank)
    await page.goto('/login');
    const [newTab] = await Promise.all([
      context.waitForEvent('popup'),
      page.getByRole('contentinfo').getByRole('link', { name: /contact support via whatsapp/i }).click(),
    ]);
    await expect(newTab).toHaveURL(/^https:\/\/wa\.me\//);
    await newTab.close();
  });
});
```
**Verify:** `cd pmo-portal && npx playwright test AC-LEG-022` → green (with `VITE_HELP_WHATSAPP` set in `.env.local`).

### Task 6.2 — `AC-LEG-024-mobile-account-menu.spec.ts` (E2E) — AC-LEG-024
**File:** `pmo-portal/e2e/AC-LEG-024-mobile-account-menu.spec.ts` (NEW)
```ts
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

/**
 * AC-LEG-024 — mobile account menu (<640px) links work. The entries live in the
 * real `acctOpen` dropdown (ContextBar.tsx). Each Terms/Privacy click leaves the
 * shell and lands on the bare public page (FR-LEG-003) — proven by the absence of
 * the ContextBar banner landmark. Help-leg requires VITE_HELP_WHATSAPP (see plan
 * Slice 6 prerequisite).
 */
test.describe('AC-LEG-024 mobile account menu links', () => {
  test('AC-LEG-024 Terms / Privacy / Help from the mobile account menu', async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, 'admin@acme.test');
    await page.goto('/'); // inside the shell so the ContextBar renders

    // Terms
    await page.getByRole('button', { name: /account menu/i }).click();
    await page.getByTestId('mobile-account-menu').getByRole('link', { name: /^terms$/i }).click();
    await expect(page).toHaveURL(/\/terms$/);
    await expect(page.getByRole('banner')).toHaveCount(0); // bare page — no ContextBar

    // Privacy
    await page.goto('/');
    await page.getByRole('button', { name: /account menu/i }).click();
    await page.getByTestId('mobile-account-menu').getByRole('link', { name: /^privacy$/i }).click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.getByRole('banner')).toHaveCount(0);

    // Help → wa.me new tab
    await page.goto('/');
    await page.getByRole('button', { name: /account menu/i }).click();
    const [newTab] = await Promise.all([
      context.waitForEvent('popup'),
      page.getByTestId('mobile-account-menu').getByRole('link', { name: /contact support via whatsapp/i }).click(),
    ]);
    await expect(newTab).toHaveURL(/^https:\/\/wa\.me\//);
    await newTab.close();
  });
});
```
**Verify:** `cd pmo-portal && npx playwright test AC-LEG-022 AC-LEG-024` → green.

---

## FINAL GATE (binding — run before opening the PR)

From `pmo-portal/`:
```bash
npm run verify          # = typecheck && lint:ci && test && build  (the WHOLE suite, not touched files)
npx playwright test AC-MOBILE-OVERFLOW-001 AC-VISUAL-ICON-001 AC-LEG-022 AC-LEG-024   # integration tier (local; CI runs on PR→main)
```
`npm run verify` MUST be green before phase transition (binding — full suite catches cross-component breakage from the shared-component edits to `ContextBar.tsx`/`LoginPage.tsx`/`App.tsx`). Targeted vitest runs above are for the inner TDD loop only.

**Slice independence:** each slice leaves the suite green when built on the prior ones — Slice 1 (config), then Slice 2 (pages — depends on 1), then Slice 3 (entry points — depends on 1), then Slices 4/5/6 (independent of each other; 6 depends on 2+3). Build order: **1 → 2 → 3 → {4, 5, 6}**.

---

## Open questions for the Director

1. **WhatsApp number for e2e (blocks the Help-legs of AC-LEG-022/024 only).** The dev-server build (`npm run dev`, read by Playwright's `webServer`) must have `VITE_HELP_WHATSAPP` set for the Help link to render. Until the owner provides the real E.164 (GTM item 8), is a **test value** `6281234567890` acceptable in `pmo-portal/.env.local` so the e2e Help-legs pass? (The Terms/Privacy legs pass unconditionally; the unit tests mock `legalConfig` and are unaffected.) *Not blocking for code merge — only for the e2e Help-legs going green.*
2. **Governing Law body text (M12, deferred).** Confirmed deferred to counsel — the Terms "Governing Law" section ships heading-only with a muted "to be confirmed" marker (not a clause). No action needed this issue; flagged so reviewers don't read the marker as provisional legal text.
3. **No new ADR.** This plan adds no irreversible/cross-cutting decision (env seam = existing `VITE_*` convention; public route = existing `/login` pattern; skip-link/`<main>` = existing `AppShell` pattern; hosting-location config = ADR-0047). Confirm no ADR is desired; if the Director wants the env-seam pattern recorded for future config-seamed features, say so and I'll draft a short ADR.

PLAN-DONE
