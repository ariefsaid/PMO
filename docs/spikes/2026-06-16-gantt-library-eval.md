# SPIKE: Gantt library evaluation — replace the hand-rolled read-only Gantt?

**Date:** 2026-06-16 · **Type:** throwaway spike (no PR for prototype code; this doc is the deliverable)
**Question:** Should we replace `pages/project-detail/ProjectGantt.tsx` + `src/lib/gantt/ganttLayout.ts`
with a vendored Gantt library — and which one — to get conventional MS-Project-style UX (left task
grid + right timeline, selectable zoom, gridlines), real dependency connector lines, and milestones as
axis diamonds, **themeable to our single-blue DESIGN.md tokens, on a permissive license**?

**Harness:** isolated Vite + React 19 app (`/tmp/gantt-spike`, throwaway), fed mock data matching the
real `TaskWithRefs` (id, name, status, start_date, end_date, milestone_id, dependencies[]) and
`MilestoneWithProgress` (id, name, target_date, sort_order, weight, effective_pct) shapes — a solar-EPC
project: 4 phase-milestones (Engineering/Procurement/Construction/Commissioning), 12 tasks (10 dated +
2 undated), 11 dependency edges, milestone target dates. Rendered + axe-audited via Playwright. No real
app/auth wired.

---

## TL;DR RECOMMENDATION

> **KEEP CUSTOM — but fix it.** Neither hands-on candidate clears the bar for *this* app.
> - **SVAR `wx-react-gantt`** is the best-looking, most feature-complete option, but it is **GPLv3 on
>   npm** (commercial license required for our closed-source SaaS) **and crashes on React 19** (uses
>   `ReactCurrentDispatcher`, removed in React 19). Two independent hard blockers. **Exclude.**
> - **Frappe Gantt** is MIT and small, and *does* theme to our blue + draws real dependency arrows +
>   has zoom — but it has **no milestone-diamond/lane model**, **zero built-in a11y** (no keyboard nav,
>   no ARIA, axe: 1 critical + serious 38-node contrast fail), ships **no TS types**, and is **vanilla
>   JS we'd have to wrap + imperatively re-init** in React. The adapter + a11y wrapper + diamond work is
>   ~the same effort as fixing our own component, but yields a less accessible result we don't control.
> - **The custom component is already 80% there** and is the *most accessible* of the three (it's a
>   `<figure role="img">` with per-bar `aria-label`, keyboard activation, text status labels, token
>   theming by construction). Its real gaps — milestone diamonds on the axis, dependency connector
>   lines, and a task-table + zoom — are **bounded, well-understood SVG/layout work**, not a reason to
>   take on a vendor's skin, bundle, license, and a11y debt.
>
> **Migration effort: fix-custom = M** (mostly: diamonds + connector lines + optional task-table/zoom).
> Adopting either vendor is **also M–L** once you add the adapter, a11y wrapper, and theme-fighting —
> with worse coherence and (SVAR) a license bill. The custom path wins on every one of our top
> priorities (a11y → performance → coherence).

---

## Scored comparison (1–5; 5 = best)

| Criterion (weight) | Custom (today) | **Frappe (MIT)** | **SVAR (GPLv3)** |
|---|:--:|:--:|:--:|
| **Themeability to single-blue tokens** ⭐ most important | 5 | **3** | 2 |
| Dependency connector lines | 1 (text only) | **5** | 5 |
| MS-Project layout (grid + timeline + zoom + gridlines) | 2 | **3** | 5 |
| Milestones as axis diamonds / lanes | 2 (badge, not diamond) | **1** (no native diamond/lane) | 4 |
| **Accessibility** (kbd/ARIA/axe) | **5** | **1** | 2* |
| Bundle-size delta (gzip) | baseline ~7.9 kB | **+~17.5 kB** | +~123 kB |
| License (permissive?) | n/a (ours) | **5 (MIT)** | **1 (GPLv3/commercial)** |
| Maintenance / popularity | n/a | **4** (132k dl/wk, 6k★) | 3 (7.8k dl/wk, 242★) |
| TS types quality | 5 (ours) | **1** (none shipped; stale `@types`) | 1 (none shipped) |
| React 19 fit | 5 | **4** (wrap vanilla JS) | **1 (CRASHES on R19)** |
| Read-only fit + future read-write | 4 | 3 | 5 |

\*SVAR a11y not directly testable here — it never rendered under React 19. Score is from its imposed-skin
DOM and docs; even if it ran, its theme system fights our tokens.

---

## License & maintenance facts (verified 2026-06-16)

| Lib | npm pkg | **License (npm-published)** | Last release | Downloads/wk | Stars | React 19? | TS types |
|---|---|---|---|---|---|---|---|
| **SVAR React Gantt** | `wx-react-gantt@1.3.1` | **GPLv3** (commercial for closed-source) | 2025-02-03 | 7.8k | 242 | **No** (peer `react@^18.3.1`; crashes) | None (`types: undefined`) |
| **Frappe Gantt** | `frappe-gantt@1.2.2` | **MIT** | 2026-02-25 | 132.7k | 6.0k | via wrapper | None shipped; stale `@types/frappe-gantt@0.9.0` |
| DHTMLX Gantt (desk) | `dhtmlx-gantt@10.0.0` | **MIT** (Community ed.) — *brief's "GPLv2 viral risk" is OUTDATED; relicensed to MIT* | 2026-06-11 | 32.2k | ~? | yes | yes (ships types) |
| Bryntum Gantt (desk) | `@bryntum/gantt` | **Commercial only** (paid per-dev) | active | — | yes | yes |

### ⚠ SVAR license trap (decision-relevant)
The SVAR **marketing page** and the **GitHub `license.txt`** say *MIT*. The **actually-published npm
package does NOT**: `wx-react-gantt@1.3.1` ships a **GPLv3 `LICENSE.md`**, declares `"license":"GPLv3"`
in `package.json`, and its own `readme.md` states verbatim: *"SVAR Gantt for React can be used for free
under GPLv3. If you would like to use it in a commercial, non-open source project, please contact us for
licensing options."* For our closed-source commercial SaaS, `npm i wx-react-gantt` = **viral GPLv3** or
**buy a commercial license**. (You *could* vendor the MIT GitHub source by hand, but that's fragile and
forgoes npm updates — not a posture for a production dependency.)

### Desk-ruled candidates
- **DHTMLX Gantt** — *license re-checked:* Community Edition is **now MIT** (npm `dhtmlx-gantt@10`),
  not the GPLv2 the brief assumed. So no longer a license blocker. **Still recommend excluding for MVP:**
  it's a large, opinionated lib that imposes its own DHTMLX skin (heavy theme-override surface to reach
  single-blue), bigger bundle, and Pro-gated advanced features. Re-evaluate only if Frappe's diamond/a11y
  gaps prove too costly *and* we want a batteries-included grid.
- **Bryntum Gantt** — **commercial paid** per-developer license. Excellent product, but **out of scope
  for an MVP** on cost grounds. Revisit only if Gantt becomes a headline, revenue-driving feature.

---

## Hands-on evidence

### SVAR `wx-react-gantt` — RULED OUT at runtime
- `npm i wx-react-gantt` fails peer-dep resolution (`peer react@^18.3.1` vs our `react@19`); installs only
  with `--legacy-peer-deps`.
- At render it throws **`TypeError: Cannot read properties of undefined (reading 'ReactCurrentDispatcher')`**
  and blanks the page. Root cause confirmed in the dist: **15 references to `ReactCurrentDispatcher` /
  `__SECRET_INTERNALS`** — React-18 internals **removed in React 19**. Not a config artifact; a hard
  framework-version incompatibility.
- Bundle: **~108 kB JS + ~15 kB CSS gzip (~123 kB)** — 15× our current footprint.
- Verdict: **two independent hard blockers (GPLv3 + React-19 crash).** Exclude regardless of feature lead.

### Frappe Gantt — works, but with real gaps
Rendered successfully (Month view shown; today=Jun 2026). Observed:
- ✅ **Themeable to our tokens.** Overriding its CSS vars + SVG classes, bars paint exactly
  `hsl(var(--primary)/0.15)` fill + `hsl(var(--primary)/0.35)` border (computed `rgba(37,99,235,0.15)` /
  `…0.35`) — our custom Gantt's look. Arrows → `--muted-foreground`. This is the single most important
  criterion and Frappe **passes** (score 3 not 5 only because you fight its defaults — bar *labels* stay
  near-black `rgb(9,9,11)` and milestone bars carry their own tint until overridden).
- ✅ **Dependency arrows.** All **11** edges render as clean elbowed finish-to-start `<path>` connectors
  (`data-from`/`data-to`). Exactly what the owner wants — the custom Gantt's biggest gap, solved natively.
- ✅ **Zoom / view modes.** Built-in `view_mode_select` dropdown: Hour→Quarter-Day→…→Day/Week/Month/Year.
  Switching re-scales the axis live. Gridlines + year/month axis headers + today-line all present.
- ❌ **Milestones.** Frappe has **no native diamond shape and no milestone *lane* grouping**. Our 4
  milestones had to be modeled as zero-duration "tasks", which Frappe pads into min-width **bars on their
  own rows** (I prepended a "◆" to the label as a hack). True axis-diamonds + milestone-grouped lanes (our
  current lane model) would be **custom SVG on top of Frappe** — i.e. we'd still be hand-drawing the part
  the owner specifically called out.
- ❌ **Accessibility (serious).** axe on the rendered chart: **`select-name` (critical)** — the view-mode
  `<select>` has no accessible name; **`color-contrast` (serious, 38 nodes)**. **0** focusable elements
  (no `tabindex`), **no `role`/`aria-label` on the SVG**, **0** keydown handlers in the entire dist. A
  screen-reader user gets nothing. Our custom component is *far* better here by construction.
- ⚠ **Integration friction.** Vanilla JS — needs a hand-rolled React wrapper with `useEffect`
  init + manual teardown (`innerHTML=''`) on re-render. Its `package.json` `exports` map **blocks the
  deep `./dist/...css` import** (had to import via node_modules path). **No shipped TS types**; the
  community `@types/frappe-gantt` is at `0.9.0` vs lib `1.2.2` (stale, API drift risk).
- Bundle: **~15.7 kB JS + ~1.8 kB CSS gzip (~17.5 kB)** → **+~9.6 kB net** over our ~7.9 kB custom Gantt.

Screenshots: `/.playwright-mcp/frappe-month2.png` (Month, bars+arrows+today-line+milestone rows),
`frappe-week.png` (Week zoom — axis re-scaled).

---

## Data-adapter sketch (what wiring either vendor would cost)

Our model is **milestone-grouped lanes**; both libs are **flat task lists**. The adapter must:

**Frappe** (flat list + custom_class theming):
```
task  → { id, name, start: start_date ?? end_date, end: end_date ?? start_date,
          progress: status→{Done:100,'In Progress':50,else:0},
          dependencies: deps.map(d=>d.depends_on_id).join(','),   // arrows: native ✅
          custom_class: status→'bar-done|bar-progress-status|bar-blocked' }  // theming hook
milestone → zero-duration task { start:end:target_date, custom_class:'bar-milestone' }  // ⚠ NOT a diamond/lane
undated   → dropped from chart; surfaced in our own footer (libs can't plot dateless rows)
```
Still-needed beyond the adapter: (1) **milestone lanes** — group tasks under milestone headers (Frappe
won't); (2) **axis diamonds** — custom SVG overlay; (3) **a11y wrapper** — `role`, `aria-label` per bar,
keyboard handlers, label the `<select>`; (4) **status pills / text labels** to match our cards.

**SVAR** (summary-parent rows + links): milestone → `type:'summary'` parent row; task →
`{parent: milestone_id}`; dep → `links:[{source,target,type:'e2s'}]`; same-day task → `type:'milestone'`
(SVAR *does* draw diamonds). Cleaner data fit — but moot given the license + React-19 blockers.

---

## Why "keep custom" wins on our priorities

1. **Accessibility (our #1).** Custom is already the most accessible of the three. Adopting Frappe
   *regresses* a11y (no kbd, no ARIA, contrast fails) and we'd rebuild what we already have to claw it back.
2. **Performance (our #2).** Custom is ~7.9 kB and pure-presentational (no extra runtime). Frappe = +17.5 kB
   + imperative re-init; SVAR = +123 kB. Keeping custom is strictly best for LCP/INP.
3. **Coherence (our #3).** Custom *is* the design system — tokens by construction, no skin to fight.
   Frappe themes acceptably but you fight its label/milestone defaults forever; SVAR imposes Willow.
4. **Control / maintainability.** No vendor lock, no GPL exposure, no stale-types risk, no wrapper to babysit
   across React majors. The owner's exact asks (diamonds, connector lines, MS-Project layout, zoom) are all
   **buildable in our existing pure `ganttLayout.ts` + SVG** with full token + a11y control.

### Recommended fix-custom scope (effort **M**)
- **Connector lines** — replace "depends on N" text with real finish-to-start SVG paths between bars
  (we already have each bar's left/width fraction + lane row; compute elbow paths). *This is the headline fix.*
- **Milestone diamonds on the axis** — render `GanttMarker.left` as a `◆` positioned on the axis row
  (move the right-aligned header badge to a dated diamond), keyboard-focusable like bars.
- **MS-Project layout** — add an optional **left task table** column block + **user-selectable zoom**
  (day/week/month/quarter) driving the existing `buildMonthTicks` (generalize to a `unit` param) + gridlines.
- Keep the existing `<figure role="img">`, per-bar `aria-label`, text status pills, undated footer, and
  `onActivateTask` keyboard activation — they already meet our a11y bar.

---

## Appendix — reproduction
Throwaway harness lives at `/tmp/gantt-spike` (Vite + React 19; `npm run dev` → :5199). Tabs: Frappe
(renders) / SVAR (error-boundaried to demonstrate the React-19 crash without blanking the page). Mock
data in `src/mockData.ts` mirrors `TaskWithRefs` / `MilestoneWithProgress`. Not committed (spike).
