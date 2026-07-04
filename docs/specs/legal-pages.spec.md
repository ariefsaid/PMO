# Legal Pages + Help Links — Feature Specification

**Status:** Spec (owner grill complete 2026-07-04, ADR-0047/0048 reality-anchored; fix-round 2026-07-04)
**Issue:** GTM MVP item 4 — Legal floor (Indonesia)
**Source:** `docs/backlog.md` §GTM/MVP-viability program (item 4) · `docs/legal/2026-07-04-msa-brief.md`
**Out-of-scope:** cookie banner · GDPR self-service · in-app consent flows · CMS/markdown pipeline · ToS acceptance checkboxes

---

## 1. Overview

### 1.1 User value

The legal pages provide **transparency and compliance grounding** for PMO Portal as a B2B SaaS operating in Indonesia. Clients (contract-/project-based organizations) need clear answers to four questions before committing:

1. **What data do you hold, where, and who owns it?** — data residency, ownership, export, deletion
2. **How do you use my data for AI features?** — AI-processing disclosure per MSA brief §4
3. **How do I get help?** — WhatsApp support channel (wa.me URL)
4. **What are the commercial terms?** — Terms of Service template

This is the **minimum legal floor** for Indonesia GTM viability (owner-confirmed, 2026-07-04). The pages are **template-grade** (section outlines + required clauses). All site-specific values (legal entity name, domain, contact email, WhatsApp number, hosting location) are sourced from `VITE_LEGAL_*` build-time env vars through one typed seam (`src/lib/legalConfig.ts`) and ship **presentable defaults**, so an unset env var never renders a bracket placeholder. The actual prose lands at build via counsel refinement, not in code.

### 1.2 Scope

**IN:**
- Public static routes `/terms` and `/privacy` — no auth required (siblings of `/login`, outside `RequireAuth` — `App.tsx:405-408`)
- **One bare public page per route for everyone** (no AppShell variant, no conditional chrome — see FR-LEG-003)
- Template-grade content with Indonesia B2B SaaS posture:
  - Data ownership, export, deletion clauses (per MSA brief §4)
  - AI-processing disclosure (Assistant → third-party LLM providers via OpenRouter)
  - Data residency answer (per-client Supabase Cloud Pro; hosting location pinned in config)
- Legal config sourced from `VITE_LEGAL_*` env vars via the typed seam `src/lib/legalConfig.ts` (single source), with presentable defaults so unset env never renders a bracket (I6)
- Footer links on the login page (Terms · Privacy · Help)
- Legal-page cross-links (Terms ↔ Privacy) + Help + back link
- In-app Help entry points: ONE inline Help icon-link in the desktop right-cluster (≥640px) next to Sign out, and Terms/Privacy/Help entries in the mobile account menu (`acctOpen`, <640px)
- Help link = `wa.me/<E.164>` URL constructed from `HELP_WHATSAPP` config (omitted entirely when the number is unset, so no broken link renders)
- a11y + mobile: no horizontal overflow at 390px/360px — `/terms` and `/privacy` are **added to the hand-maintained `ROUTES` arrays** in both gate files (`AC-MOBILE-OVERFLOW-001` + `AC-VISUAL-ICON-001`); there is no automatic registration (C2)
- DESIGN.md typography/prose tokens for page rendering

**OUT:**
- Cookie banner / cookie consent mechanism (deferred post-MVP)
- GDPR self-service data export / deletion UI
- In-app consent flows for AI features
- CMS/markdown pipeline (hardcoded TSX prose is fine for MVP)
- ToS acceptance checkboxes at sign-up

### 1.3 Reality anchors

- **ADR-0047** (GTM production topology): per-client Supabase Cloud Pro + CF Pages; hosting location = config-seamed (Singapore default per client project; staging is Sydney)
- **ADR-0048** (ERPNext accounting): no accounting features in PMO; ERPNext is headless accounting engine, client-operated
- **MSA brief §4** (data clauses): client owns its data; export anytime (self-service CSV/XLSX); termination export within 30 days, deletion after 60–90 days; isolation per environment; AI-processing disclosure; confidentiality
- **GTM item 8** (support floor): WhatsApp group per client, business-hours response target (owner will pick number); help link = wa.me URL from config. `HELP_WHATSAPP` is a single global config value for the single-tenant MVP; the `org_id` seam makes it per-org later (M15).
- **Env-var convention:** every build-time config value is a `VITE_*` var inlined at build (`docs/environments.md:143,157-168`); `docs/backlog.md:60` directs building against env-var seams. Legal config follows the same convention via `VITE_LEGAL_*`.

---

## 2. Functional Requirements (EARS)

### 2.1 Public static routes (single bare page per route)

**FR-LEG-001:** When an unauthenticated user navigates to `/terms`, the system shall render the Terms of Service page without requiring authentication.

**FR-LEG-002:** When an unauthenticated user navigates to `/privacy`, the system shall render the Privacy Policy page without requiring authentication.

**FR-LEG-003:** When any user — authenticated or unauthenticated — navigates to `/terms` or `/privacy`, the system shall render the SAME bare public page (no AppShell, no rail, no ContextBar). There is one page per route for everyone; the route lives outside `RequireAuth` (`App.tsx:405-408`), so an authenticated user reaching `/terms` sees the identical bare page (no conditional chrome, no in-shell variant).

**FR-LEG-004:** When a user navigates to `/terms` or `/privacy`, the system shall render page content using DESIGN.md typography/prose token classes (page-title, heading, subheading, body, overline scales).

**FR-LEG-005:** When a user navigates to `/terms` or `/privacy`, the system shall render an auth-aware back link: unauthenticated → label "Back to sign in", destination `/login`; authenticated → label "Back to app", destination `/`. (Rationale: `/` is under `RequireAuth` — `App.tsx:407-408` + `RequireAuth.tsx` `!session → <Navigate to="/login" replace />` — so the unauthenticated primary audience lands on `/login`, not the app; I9.)

### 2.2 Config seam (`src/lib/legalConfig.ts`)

**FR-LEG-006:** When the app builds, the system shall source all legal configuration through a single typed seam, `src/lib/legalConfig.ts`, which reads the `VITE_LEGAL_*` build-time environment variables and exports them as typed constants. This is the one mechanism, stated once, used by every FR/AC that needs a site-specific value (no hardcoded literals elsewhere).

**FR-LEG-007:** When `legalConfig.ts` loads, it shall export the following typed constants, each sourced from its corresponding `VITE_LEGAL_*` env var (`import.meta.env`), and each falling back to a presentable default when its env var is unset (so no bracket placeholder ever renders — I6):

| Constant | Env var | Default (when unset) |
|---|---|---|
| `LEGAL_ENTITY_NAME` | `VITE_LEGAL_ENTITY_NAME` | `"PMO Portal"` |
| `DOMAIN` | `VITE_LEGAL_DOMAIN` | `"pmoportal.app"` |
| `CONTACT_EMAIL` | `VITE_LEGAL_CONTACT_EMAIL` | `"support@pmoportal.app"` |
| `HELP_WHATSAPP` | `VITE_HELP_WHATSAPP` | `""` (empty → Help affordance omitted, see FR-LEG-010) |
| `HOSTING_LOCATION` | `VITE_HOSTING_LOCATION` | `"Singapore"` |

**FR-LEG-008:** When the Terms page renders, it shall display the legal entity name, domain, and contact email from `legalConfig.ts` (never literal bracket placeholders).

**FR-LEG-009:** When the Privacy page renders, it shall display the legal entity name, domain, contact email, and hosting location from `legalConfig.ts` (never literal bracket placeholders).

**FR-LEG-010:** When a Help affordance renders, it shall use the URL `https://wa.me/${HELP_WHATSAPP}` where `HELP_WHATSAPP` is the E.164-formatted number from `legalConfig.ts`. When `HELP_WHATSAPP` is unset/empty, the Help affordance shall be omitted entirely rather than rendering a broken `wa.me/` link.

### 2.3 Content structure — Terms of Service

**FR-LEG-011:** When the Terms page renders, it shall display the following section headings (template-grade, no full prose):
1. Acceptance of Terms
2. Services
3. User Responsibilities
4. Data Ownership
5. Confidentiality
6. Limitation of Liability
7. Term and Termination
8. Governing Law

The "Governing Law" section is **heading-only** (no clause text) and intentionally deferred: MSA brief §8 (`docs/legal/2026-07-04-msa-brief.md:87-94`) flags governing law (Indonesia vs BANI arbitration vs district court) as a live counsel question. Clause text lands via counsel, not in code (M12).

**FR-LEG-012:** When the Terms page renders the "Services" section, it shall include a clause referencing the MSA/subscription agreement as the master commercial contract.

**FR-LEG-013:** When the Terms page renders the "Data Ownership" section, it shall include a clause stating that the client owns its data and grants the vendor only the license needed to operate the service.

**FR-LEG-014:** When the Terms page renders the "Term and Termination" section, it shall include clauses for initial term, auto-renewal, termination for convenience, and termination for cause.

### 2.4 Content structure — Privacy Policy

**FR-LEG-015:** When the Privacy page renders, it shall display the following section headings (template-grade, no full prose):
1. Data We Collect
2. Data Ownership
3. How We Use Your Data
4. AI Processing Disclosure
5. Data Location
6. Data Export
7. Data Retention and Deletion
8. Confidentiality and Security
9. Contact Us

**FR-LEG-016:** When the Privacy page renders the "Data Ownership" section, it shall include a clause stating that the client owns its data and the vendor gets only the license needed to operate the service.

**FR-LEG-017:** When the Privacy page renders the "Data Location" section, it shall include a clause stating the hosting location, sourced from `HOSTING_LOCATION` (per-client Supabase Cloud Pro; Singapore default, configurable per ADR-0047).

**FR-LEG-018:** When the Privacy page renders the "Data Export" section, it shall include a clause stating that clients can export their data anytime via in-product CSV/XLSX export and receive a full export within 30 days on termination.

**FR-LEG-019:** When the Privacy page renders the "Data Retention and Deletion" section, it shall include a clause stating that client data is deleted within 60–90 days after termination.

**FR-LEG-020:** When the Privacy page renders the "AI Processing Disclosure" section, it shall include a clause stating that the Assistant sends user prompts and minimum necessary data context to third-party LLM providers (via OpenRouter) to answer requests, no client data is used to train models, and vendor staff do not read Assistant conversation content (aggregates only).

**FR-LEG-021:** When the Privacy page renders the "Confidentiality and Security" section, it shall include a clause stating mutual confidentiality, daily backups, and per-client isolation.

**FR-LEG-022:** When the Privacy page renders the "Contact Us" section, it shall display the contact email and help WhatsApp link using values from `legalConfig.ts`.

### 2.5 Footer, cross-links, and navigation

**FR-LEG-023:** When the login page renders, it shall display a footer with three links — "Terms", "Privacy", and "Help" — where Help opens the wa.me URL in a new tab (Terms · Privacy · Help).

**FR-LEG-024:** When a legal page renders, it shall cross-link to the other legal page (Terms ↔ Privacy) and to Help (wa.me), in addition to the auth-aware back link (FR-LEG-005). This is the in-page navigation surface for the public audience.

**FR-LEG-025:** When a user clicks a "Terms" or "Privacy" link anywhere it appears (login footer, legal-page cross-links, mobile account menu), the system shall navigate to `/terms` or `/privacy` respectively.

**FR-LEG-026:** When a user clicks a "Help" link anywhere it appears, the system shall open `https://wa.me/${HELP_WHATSAPP}` in a new tab (`target="_blank" rel="noopener noreferrer"`). (No-op/omitted when `HELP_WHATSAPP` is unset — FR-LEG-010.)

### 2.6 In-app placement (mobile account menu + desktop cluster)

**FR-LEG-027:** When the mobile account menu (the real `acctOpen` dropdown, `<640px`, rendered at `src/components/shell/ContextBar.tsx:196`) renders, it shall include "Terms", "Privacy", and "Help" entries (Help = wa.me new tab), in addition to the existing role-switcher and Sign out.

**FR-LEG-028:** When the desktop right-cluster (≥640px, the inline cluster at `src/components/shell/ContextBar.tsx:116`) renders, it shall include exactly ONE inline "Help" icon-link (wa.me, `aria-label="Contact support via WhatsApp"`) placed next to the "Sign out" button. There is NO new dropdown on desktop, and NO Terms/Privacy entries on the desktop chrome — Terms/Privacy are reachable on desktop via the login-page footer, the legal-page cross-links, and direct URL. (The desktop cluster is inline role-switcher + user chip + Sign out today; this FR adds one icon-link to it — I5.)

### 2.7 Gate registration + a11y landmarks

**FR-LEG-029:** When the legal routes ship, the system shall register `/terms` and `/privacy` in the hand-maintained `ROUTES` arrays of BOTH mobile/visual gate files — `e2e/AC-MOBILE-OVERFLOW-001-no-horizontal-bleed.spec.ts` (`ROUTES` at `:34`, iterated `for (const route of ROUTES)` at `:93` → `page.goto(route.path)` at `:97`) and `e2e/AC-VISUAL-ICON-001-no-oversized-icons.spec.ts` (`ROUTES` at `:30`, loop at `:109` → `page.goto` at `:113`). There is no automatic registration — new routes are invisible to the gates until added to these arrays (C2). (The gates sign in then `goto` each route; the public pages render their bare page regardless of auth — FR-LEG-003 — so inclusion is safe.)

**FR-LEG-030:** When a legal page renders, it shall contain exactly one `<main>` landmark (`<main id="main">`), mirroring the in-shell pattern at `src/components/shell/AppShell.tsx:167-168`. The bare public pages render outside `<Shell>`, so they cannot inherit the shell's `<main>` (M10).

**FR-LEG-031:** When a legal page renders, it shall include a "Skip to main content" skip link targeting `#main`, mirroring the in-shell pattern at `src/components/shell/AppShell.tsx:142-145` (M10).

---

## 3. Non-Functional Requirements

**NFR-LEG-001:** The `/terms` and `/privacy` routes shall render with no horizontal overflow at viewport widths 390px and 360px. Coverage is NOT automatic: the routes must be present in the hand-maintained `ROUTES` arrays of both gate files (FR-LEG-029), where the gates iterate them (C2).

**NFR-LEG-002:** Legal pages shall render under the app-wide viewport meta tag `width=device-width, initial-scale=1.0` and **zoom shall never be disabled** (no `user-scalable=no` / `maximum-scale` — WCAG 1.4.4). This is already satisfied by the existing tag in `pmo-portal/index.html` (`<meta name="viewport" content="width=device-width, initial-scale=1.0" />`); no new work and no zoom lock (I7). (Satisfied-by-existing; no per-feature AC.)

**NFR-LEG-003:** Legal page content shall be screen-reader accessible:
- Proper heading hierarchy (`h1` for page title, `h2` for section headings)
- Links have descriptive labels (not "click here")
- Help link has `aria-label="Contact support via WhatsApp"`
- Exactly one `<main>` landmark + skip link (FR-LEG-030/031)

**NFR-LEG-004:** Legal page colors shall meet WCAG-AA contrast in both light and dark themes (foreground vs background contrast ≥4.5:1).

**NFR-LEG-005:** Legal configuration shall be environment-based via the `VITE_LEGAL_*` env-var seam in `src/lib/legalConfig.ts` (FR-LEG-006/007), never hardcoded literals, so values vary between dev/staging/prod builds — consistent with the project's `VITE_*` build-time convention (`docs/environments.md:143,157-168`).

**NFR-LEG-006:** Legal pages shall render deterministically: identical config produces identical text, with no date-, time-, or random-derived content (e.g. no "last updated <today>" unless it is itself a config constant). (Replaces the deleted SSR/hydration NFR — the app is a client-rendered Vite SPA using `BrowserRouter`, `App.tsx:403`; there is no hydration. I8.)

> NFR-LEG-007 ("URLs never change without a redirect") from the prior draft is **removed**: it was an orphan with no owning AC — aspirational process, not a per-feature acceptance (M11).

---

## 4. Acceptance Criteria (Given/When/Then)

### 4.1 Public routes accessibility (single bare page)

**AC-LEG-001:** (Unit/Vitest RTL) Unauthenticated users see the bare Terms page
- **Given** an unauthenticated session
- **When** a user navigates to `/terms`
- **Then** the Terms of Service page renders without redirecting to `/login`
- **And** the page title reads "Terms of Service"
- **And** the AppShell (rail + ContextBar) does NOT render (bare public page — FR-LEG-003)

**AC-LEG-002:** (Unit/Vitest RTL) Unauthenticated users see the bare Privacy page
- **Given** an unauthenticated session
- **When** a user navigates to `/privacy`
- **Then** the Privacy Policy page renders without redirecting to `/login`
- **And** the page title reads "Privacy Policy"
- **And** the AppShell (rail + ContextBar) does NOT render (bare public page — FR-LEG-003)

> AC-LEG-003 (prior draft: "authenticated users see legal pages in-app shell") is **deleted** — the in-shell branch is removed (FR-LEG-003 now mandates the same bare page for everyone; I4).

**AC-LEG-004:** (Unit/Vitest RTL) Legal pages render with typography token classes
- **Given** a user on the `/terms` page
- **When** the page renders
- **Then** the page heading is an `h1` using the DESIGN.md page-title token class
- **And** section headings are `h2` using the heading token class
- **And** body text uses the body/prose token class
- (Asserts token-class presence, not computed px/weight — downgraded from E2E per ADR-0010 / M13.)

### 4.2 Config seam

**AC-LEG-005:** (Unit/Vitest) `legalConfig.ts` exports the five typed constants
- **Given** the `src/lib/legalConfig.ts` module
- **When** the module loads
- **Then** it exports `LEGAL_ENTITY_NAME`, `DOMAIN`, `CONTACT_EMAIL`, `HELP_WHATSAPP`, and `HOSTING_LOCATION`
- **And** each is sourced from its corresponding `VITE_LEGAL_*` env var (reflecting `import.meta.env` overrides)

**AC-LEG-006:** (Unit/Vitest RTL) Terms page renders config values (no brackets)
- **Given** the `/terms` page with `legalConfig` providing test values
- **When** the page renders
- **Then** the page displays the test entity name, domain, and contact email
- **And** no `[LEGAL-ENTITY]`, `[DOMAIN]`, or `[CONTACT_EMAIL]` bracket placeholders remain visible

**AC-LEG-007:** (Unit/Vitest RTL) Privacy page renders config values (no brackets)
- **Given** the `/privacy` page with `legalConfig` providing test values
- **When** the page renders
- **Then** the page displays the test entity name, domain, contact email, and hosting location
- **And** no bracket placeholder tokens remain visible

**AC-LEG-008:** (Unit/Vitest) Help URL contract
- **Given** `HELP_WHATSAPP = "6281234567890"` from `legalConfig.ts`
- **When** the Help URL is constructed
- **Then** the resulting `href` is `https://wa.me/6281234567890`
- **And** the rendered link has `target="_blank"` and `rel="noopener noreferrer"`
- **And** when `HELP_WHATSAPP` is empty, no Help link renders (FR-LEG-010)

### 4.3 Content structure — Terms

**AC-LEG-009:** (Unit/Vitest RTL) Terms page displays required section headings
- **Given** a user on the `/terms` page
- **When** the page renders
- **Then** the page displays all 8 required section headings:
  - "Acceptance of Terms"
  - "Services"
  - "User Responsibilities"
  - "Data Ownership"
  - "Confidentiality"
  - "Limitation of Liability"
  - "Term and Termination"
  - "Governing Law"
- **And** the "Governing Law" section is heading-only (no clause body) — counsel-deferred (FR-LEG-011, M12)

**AC-LEG-010:** (Unit/Vitest RTL) Terms Services section references MSA
- **Given** a user on the `/terms` page
- **When** the Services section renders
- **Then** it includes a clause referencing the MSA/subscription agreement as the master commercial contract

**AC-LEG-011:** (Unit/Vitest RTL) Terms Data Ownership section affirms client ownership
- **Given** a user on the `/terms` page
- **When** the Data Ownership section renders
- **Then** it includes a clause stating that the client owns its data and grants the vendor only the license needed to operate the service

**AC-LEG-012:** (Unit/Vitest RTL) Terms Term and Termination includes required clauses
- **Given** a user on the `/terms` page
- **When** the Term and Termination section renders
- **Then** it includes clauses for initial term, auto-renewal, termination for convenience, and termination for cause

### 4.4 Content structure — Privacy

**AC-LEG-013:** (Unit/Vitest RTL) Privacy page displays required section headings
- **Given** a user on the `/privacy` page
- **When** the page renders
- **Then** the page displays all 9 required section headings:
  - "Data We Collect"
  - "Data Ownership"
  - "How We Use Your Data"
  - "AI Processing Disclosure"
  - "Data Location"
  - "Data Export"
  - "Data Retention and Deletion"
  - "Confidentiality and Security"
  - "Contact Us"

**AC-LEG-014:** (Unit/Vitest RTL) Privacy Data Ownership affirms client ownership
- **Given** a user on the `/privacy` page
- **When** the Data Ownership section renders
- **Then** it includes a clause stating that the client owns its data and the vendor gets only the license needed to operate the service

**AC-LEG-015:** (Unit/Vitest RTL) Privacy Data Location states hosting location
- **Given** the `/privacy` page with `HOSTING_LOCATION = "Singapore"` from `legalConfig.ts`
- **When** the Data Location section renders
- **Then** it includes a clause stating the hosting location as "Singapore"

**AC-LEG-016:** (Unit/Vitest RTL) Privacy Data Export describes export options
- **Given** a user on the `/privacy` page
- **When** the Data Export section renders
- **Then** it includes a clause stating clients can export anytime via in-product CSV/XLSX export and receive a full export within 30 days on termination

**AC-LEG-017:** (Unit/Vitest RTL) Privacy Data Retention and Deletion states timelines
- **Given** a user on the `/privacy` page
- **When** the Data Retention and Deletion section renders
- **Then** it includes a clause stating client data is deleted within 60–90 days after termination

**AC-LEG-018:** (Unit/Vitest RTL) Privacy AI Processing Disclosure matches MSA brief §4
- **Given** a user on the `/privacy` page
- **When** the AI Processing Disclosure section renders
- **Then** it includes a clause stating:
  - The Assistant sends user prompts and minimum necessary data context to third-party LLM providers via OpenRouter
  - No client data is used to train models
  - Vendor staff do not read Assistant conversation content (aggregates only)

**AC-LEG-019:** (Unit/Vitest RTL) Privacy Confidentiality and Security describes protections
- **Given** a user on the `/privacy` page
- **When** the Confidentiality and Security section renders
- **Then** it includes clauses stating mutual confidentiality, daily backups, and per-client isolation

**AC-LEG-020:** (Unit/Vitest RTL) Privacy Contact Us displays contact info from config
- **Given** the `/privacy` page with test config values
- **When** the Contact Us section renders
- **Then** it displays the contact email address
- **And** it displays the WhatsApp help link

### 4.5 Footer, cross-links, and in-app placement

**AC-LEG-021:** (Unit/Vitest RTL) Login page footer has Terms, Privacy, and Help links
- **Given** the login page
- **When** the page renders
- **Then** a footer is visible
- **And** the footer contains a "Terms" link navigating to `/terms`
- **And** the footer contains a "Privacy" link navigating to `/privacy`
- **And** the footer contains a "Help" link opening the wa.me URL in a new tab

**AC-LEG-022:** (E2E Playwright) Login page footer links navigate correctly
- **Given** an unauthenticated user on the login page
- **When** they click the "Terms" footer link
- **Then** they navigate to `/terms`
- **When** they click the "Privacy" footer link
- **Then** they navigate to `/privacy`
- (Director decision, ADR-0010 lowest-sufficient-layer: the Help leg is unit-owned by
  `AC-LEG-021` — navigating to an external `wa.me` URL is not meaningfully e2e-testable, and
  requiring `VITE_HELP_WHATSAPP` in the e2e dev-server env is fragile. The unit test already
  asserts the anchor's `href`/`target`/`rel` against an injected config value; e2e keeps only
  the in-app Terms/Privacy route navigation.)

**AC-LEG-023:** (Unit/Vitest RTL) Mobile account menu includes Terms, Privacy, Help
- **Given** an authenticated user on a viewport <640px
- **When** the mobile account menu (`acctOpen` dropdown, `ContextBar.tsx:196`) renders
- **Then** it includes a "Terms" link navigating to `/terms`
- **And** it includes a "Privacy" link navigating to `/privacy`
- **And** it includes a "Help" link opening the wa.me URL in a new tab

**AC-LEG-024:** (E2E Playwright) Mobile account menu links work correctly
- **Given** an authenticated user on a viewport <640px
- **When** they open the mobile account menu and click "Terms"
- **Then** they navigate to `/terms` (bare public page)
- **When** they open the menu and click "Privacy"
- **Then** they navigate to `/privacy` (bare public page)
- (Director decision, ADR-0010 lowest-sufficient-layer: the Help leg is unit-owned by
  `AC-LEG-023` — same rationale as AC-LEG-022.)

**AC-LEG-025:** (Unit/Vitest RTL) Desktop cluster renders one inline Help icon, no Terms/Privacy
- **Given** an authenticated user on a viewport ≥640px
- **When** the desktop right-cluster (`ContextBar.tsx:116`) renders
- **Then** it includes exactly ONE inline "Help" icon-link with `href` = `https://wa.me/<HELP_WHATSAPP>` and `aria-label="Contact support via WhatsApp"`, placed next to the "Sign out" button
- **And** it does NOT include "Terms" or "Privacy" entries (no new dropdown; those are reachable via login footer, legal cross-links, and direct URL)

### 4.6 Accessibility, landmarks, and mobile gates

**AC-LEG-026:** (Unit/Vitest) Legal routes are present in both sweep `ROUTES` arrays
- **Given** the two gate files `e2e/AC-MOBILE-OVERFLOW-001-no-horizontal-bleed.spec.ts` and `e2e/AC-VISUAL-ICON-001-no-oversized-icons.spec.ts`
- **When** the test inspects their hand-maintained `ROUTES` arrays (`:34` and `:30` respectively)
- **Then** both arrays contain entries for `/terms` and `/privacy`
- (Asserts PRESENCE in the arrays — not "automatic registration", which does not exist. The gates then iterate the arrays (`:93`/`:109`) and `page.goto` each route (`:97`/`:113`), so presence is what makes `/terms`/`/privacy` covered for no-bleed + icon-size. C2.)

**AC-LEG-027:** (Unit/Vitest RTL) Legal pages have proper heading hierarchy
- **Given** a user on the `/terms` or `/privacy` page
- **When** the page renders
- **Then** the page has exactly one `h1` element (the page title)
- **And** section headings use `h2`
- **And** sub-sections use `h3` if present

**AC-LEG-028:** (Unit/Vitest RTL) Legal page links have accessible labels
- **Given** a user on a legal page
- **When** links render
- **Then** no link uses generic text like "click here"
- **And** the Help link has `aria-label="Contact support via WhatsApp"`

**AC-LEG-029:** (Unit/Vitest RTL) Legal pages use DESIGN.md tokens for colors
- **Given** a user on a legal page
- **When** the page renders in light theme
- **Then** foreground text uses `text-foreground` or `foreground` token
- **And** heading text uses WCAG-AA contrast on the card background
- **When** the page renders in dark theme
- **Then** foreground text maintains WCAG-AA contrast on the card background

**AC-LEG-032:** (Unit/Vitest RTL) Legal pages have exactly one `<main>` landmark
- **Given** a user on the `/terms` or `/privacy` page
- **When** the page renders
- **Then** the document contains exactly one `<main>` element with `id="main"` (M10)

**AC-LEG-033:** (Unit/Vitest RTL) Legal pages have a skip link to main
- **Given** a user on the `/terms` or `/privacy` page
- **When** the page renders
- **Then** a "Skip to main content" link targeting `#main` is present (M10, mirroring `AppShell.tsx:142-145`)

### 4.7 Navigation and determinism

**AC-LEG-030:** (Unit/Vitest RTL) Auth-aware back link
- **Given** an unauthenticated user on `/terms` or `/privacy`
- **When** the page renders
- **Then** a "Back to sign in" link is visible and navigates to `/login`
- **Given** an authenticated user on `/terms` or `/privacy`
- **When** the page renders
- **Then** a "Back to app" link is visible and navigates to `/` (I9)

**AC-LEG-031:** (Unit/Vitest RTL) Legal pages cross-link each other + Help + back
- **Given** a user on `/terms`
- **When** the page renders
- **Then** it contains a "Privacy" link navigating to `/privacy`
- **Given** a user on `/privacy`
- **When** the page renders
- **Then** it contains a "Terms" link navigating to `/terms`
- **And** both pages contain a "Help" link (wa.me, new tab) and the auth-aware back link (AC-LEG-030)

**AC-LEG-034:** (Unit/Vitest RTL) Defaults render when env unset; override renders when set
- **Given** all `VITE_LEGAL_*` env vars unset
- **When** `/terms` renders
- **Then** it displays the default entity "PMO Portal", default domain, default contact email, and default hosting location "Singapore"
- **And** no bracket placeholder (`[LEGAL-ENTITY]` etc.) is ever visible
- **Given** `VITE_LEGAL_*` set to test values (e.g. entity "Acme Pty Ltd", hosting "Jakarta")
- **When** `/terms` and `/privacy` render
- **Then** the test values are displayed (I6 — proves both the default path and the override path)

**AC-LEG-035:** (Unit/Vitest RTL) Deterministic render
- **Given** the same `legalConfig` values
- **When** `/terms` renders twice
- **Then** both renders produce byte-identical text
- **And** the page contains no `Date.now()` / `Math.random()` / current-date-derived text (I8, NFR-LEG-006)

---

## 5. Error Handling

| Error Scenario | Handling | User Message |
|----------------|----------|--------------|
| `VITE_LEGAL_*` env var unset | Use the presentable default from `legalConfig.ts` (FR-LEG-007); never render a bracket placeholder | None visible (presentable default renders; developer sets the real value via `VITE_LEGAL_*` at provisioning — see `docs/environments.md` runbook line) |
| `HELP_WHATSAPP` unset/empty | Omit the Help affordance entirely (no broken `wa.me/` link renders) | None visible (Help link absent; user reaches support via contact email) |
| Help WhatsApp number not in E.164 format | Still construct wa.me URL (WhatsApp handles validation) | None visible |
| Legal page navigation during auth state change | Route works regardless of auth state (public routes; same bare page for everyone — FR-LEG-003) | None visible |

---

## 6. Implementation TODO Checklist

- [ ] Create `src/lib/legalConfig.ts` reading `VITE_LEGAL_ENTITY_NAME` / `VITE_LEGAL_DOMAIN` / `VITE_LEGAL_CONTACT_EMAIL` / `VITE_HELP_WHATSAPP` / `VITE_HOSTING_LOCATION` and exporting `LEGAL_ENTITY_NAME`, `DOMAIN`, `CONTACT_EMAIL`, `HELP_WHATSAPP`, `HOSTING_LOCATION` (with presentable defaults per FR-LEG-007)
- [ ] Create `pages/Terms.tsx` with template-grade content (8 section headings, clause outlines; Governing Law heading-only)
- [ ] Create `pages/Privacy.tsx` with template-grade content (9 section headings, clause outlines including AI disclosure per MSA brief §4)
- [ ] Add `/terms` and `/privacy` public routes to `App.tsx` OUTSIDE `RequireAuth` (siblings of `/login`, `App.tsx:405-408`); both authed and unauthed users get the same bare page
- [ ] Add `/terms` and `/privacy` to the `ROUTES` arrays in BOTH `e2e/AC-MOBILE-OVERFLOW-001-no-horizontal-bleed.spec.ts:34` AND `e2e/AC-VISUAL-ICON-001-no-oversized-icons.spec.ts:30` (hand-maintained — no automatic registration)
- [ ] Add a footer to `auth/LoginPage.tsx` with Terms · Privacy · Help links
- [ ] Add ONE inline Help icon-link to the desktop right-cluster (`ContextBar.tsx:116`) next to Sign out (no new dropdown, no Terms/Privacy on desktop chrome)
- [ ] Add Terms/Privacy/Help entries to the mobile account menu (`acctOpen`, `ContextBar.tsx:196`)
- [ ] Add legal-page cross-links (Terms ↔ Privacy) + Help + auth-aware back link
- [ ] Add exactly one `<main id="main">` landmark + "Skip to main content" skip link per legal page (mirror `AppShell.tsx:142-145,167-168`)
- [ ] Implement Help link as `https://wa.me/${HELP_WHATSAPP}` with `target="_blank" rel="noopener noreferrer"`; omit when `HELP_WHATSAPP` empty
- [ ] Add a `docs/environments.md` runbook line: "set `VITE_LEGAL_*` per client at provisioning" (I6)
- [ ] Write unit tests (Vitest RTL) for all `AC-LEG-*` owned at unit layer
- [ ] Write e2e tests (Playwright) for cross-stack `AC-LEG-*` owned at e2e layer
- [ ] Verify `/terms` and `/privacy` are present in both sweep `ROUTES` arrays (AC-LEG-026)
- [ ] Run `npm run verify` (full suite) and ensure all tests pass
- [ ] Render-verify legal pages at desktop, 390px, and 360px viewports

---

## 7. Traceability Table

| AC-ID | Owning Layer | Test File |
|-------|--------------|-----------|
| AC-LEG-001 | Unit/Vitest RTL | `pages/Terms.test.tsx` |
| AC-LEG-002 | Unit/Vitest RTL | `pages/Privacy.test.tsx` |
| ~~AC-LEG-003~~ | — | *deleted (I4: in-shell branch removed)* |
| AC-LEG-004 | Unit/Vitest RTL | `pages/Terms.test.tsx` (downgraded from E2E — M13) |
| AC-LEG-005 | Unit/Vitest | `src/lib/legalConfig.test.ts` |
| AC-LEG-006 | Unit/Vitest RTL | `pages/Terms.test.tsx` |
| AC-LEG-007 | Unit/Vitest RTL | `pages/Privacy.test.tsx` |
| AC-LEG-008 | Unit/Vitest | `src/lib/legalConfig.test.ts` |
| AC-LEG-009 | Unit/Vitest RTL | `pages/Terms.test.tsx` |
| AC-LEG-010 | Unit/Vitest RTL | `pages/Terms.test.tsx` |
| AC-LEG-011 | Unit/Vitest RTL | `pages/Terms.test.tsx` |
| AC-LEG-012 | Unit/Vitest RTL | `pages/Terms.test.tsx` |
| AC-LEG-013 | Unit/Vitest RTL | `pages/Privacy.test.tsx` |
| AC-LEG-014 | Unit/Vitest RTL | `pages/Privacy.test.tsx` |
| AC-LEG-015 | Unit/Vitest RTL | `pages/Privacy.test.tsx` |
| AC-LEG-016 | Unit/Vitest RTL | `pages/Privacy.test.tsx` |
| AC-LEG-017 | Unit/Vitest RTL | `pages/Privacy.test.tsx` |
| AC-LEG-018 | Unit/Vitest RTL | `pages/Privacy.test.tsx` |
| AC-LEG-019 | Unit/Vitest RTL | `pages/Privacy.test.tsx` |
| AC-LEG-020 | Unit/Vitest RTL | `pages/Privacy.test.tsx` |
| AC-LEG-021 | Unit/Vitest RTL | `auth/LoginPage.test.tsx` |
| AC-LEG-022 | E2E Playwright | `e2e/AC-LEG-022-login-footer.spec.ts` |
| AC-LEG-023 | Unit/Vitest RTL | `components/shell/ContextBar.test.tsx` |
| AC-LEG-024 | E2E Playwright | `e2e/AC-LEG-024-mobile-account-menu.spec.ts` |
| AC-LEG-025 | Unit/Vitest RTL | `components/shell/ContextBar.test.tsx` |
| AC-LEG-026 | Unit/Vitest | `src/lib/legal-route-registry.test.ts` (asserts presence in both sweep `ROUTES` arrays) |
| AC-LEG-027 | Unit/Vitest RTL | `pages/Terms.test.tsx`, `pages/Privacy.test.tsx` |
| AC-LEG-028 | Unit/Vitest RTL | `pages/Terms.test.tsx`, `pages/Privacy.test.tsx` |
| AC-LEG-029 | Unit/Vitest RTL | `pages/Terms.test.tsx`, `pages/Privacy.test.tsx` |
| AC-LEG-030 | Unit/Vitest RTL | `pages/Terms.test.tsx`, `pages/Privacy.test.tsx` |
| AC-LEG-031 | Unit/Vitest RTL | `pages/Terms.test.tsx`, `pages/Privacy.test.tsx` |
| AC-LEG-032 | Unit/Vitest RTL | `pages/Terms.test.tsx`, `pages/Privacy.test.tsx` |
| AC-LEG-033 | Unit/Vitest RTL | `pages/Terms.test.tsx`, `pages/Privacy.test.tsx` |
| AC-LEG-034 | Unit/Vitest RTL | `src/lib/legalConfig.test.ts`, `pages/Terms.test.tsx` |
| AC-LEG-035 | Unit/Vitest RTL | `pages/Terms.test.tsx`, `pages/Privacy.test.tsx` |

> NFR-LEG-002 is satisfied by the existing `index.html` viewport tag (no per-feature AC). NFR-LEG-006 (deterministic render) is proven by AC-LEG-035. NFR-LEG-007 (URL stability) removed — orphan (M11).

---

## 8. Deviations from MSA Brief

This spec deliberately **deviates** from the MSA brief in the following ways:

1. **No full legal prose** — The spec defines section outlines and required clauses; the actual legal prose lands at build via counsel refinement. This is a deliberate scope boundary to avoid embedding provisional legal text in code.

2. **Config-seamed values with presentable defaults** — Site-specific values (legal entity, domain, contact email, WhatsApp number, hosting location) are sourced from `VITE_LEGAL_*` env vars via `src/lib/legalConfig.ts` and ship presentable defaults so unset env never renders a bracket (I6). Hosting location in particular is a config constant (`HOSTING_LOCATION`, default "Singapore") per ADR-0047 so it can vary per client deployment without code changes.

3. **WhatsApp number as E.164 format** — The spec requires `HELP_WHATSAPP` as E.164 format (e.g., `6281234567890`) for wa.me URL construction. The MSA brief mentions "WhatsApp group per client" but does not specify the number format. `HELP_WHATSAPP` is a single global config value for the single-tenant MVP; the `org_id` seam makes it per-org later (M15).

4. **Governing Law section is heading-only, counsel-deferred** — The MSA brief §8 (`docs/legal/2026-07-04-msa-brief.md:87-94`) asks counsel to advise on governing law (Indonesia vs BANI arbitration vs district court). This spec includes the "Governing Law" section heading in Terms (FR-LEG-011) but leaves the clause text to counsel — explicitly deferred, not specified in clause FRs/ACs (M12, promoted from a note into FR-LEG-011).

5. **Backup-retention specifics counsel-deferred (optional note, M14)** — The MSA brief §4 notes daily backups with `[7]`-day retention and implicit RPO 24h (`docs/legal/2026-07-04-msa-brief.md:56-57`), warning "do not promise tighter without PITR". This spec encodes "daily backups" (FR-LEG-021/AC-LEG-019) but defers the specific retention-day/RPO number to counsel — the template-grade prose should not commit to a number the platform may not guarantee.

6. **No ERPNext-specific liability language** — The MSA brief §8 asks whether the ERPNext bundle needs its own liability language. This scope excludes ERPNext from the legal pages (ADR-0048 keeps ERPNext as a headless accounting engine separate from PMO), so no ERPNext-specific clauses are included.

All other requirements align with the MSA brief §4 (data clauses + AI-processing disclosure) and the GTM MVP item 4 scope.

---

SPEC-FIX-DONE
