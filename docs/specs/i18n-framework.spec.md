# i18n framework — spec

**Issue:** #468 (CLOSED, rulings binding) · **Sequence:** #450 step 1 · **Rulings:** `OD-CR-3`,
`OD-CR-5`, `DD-I18N-1..6`, `DD-RIS-2` · **Prefix:** `FR-L10N-###` / `AC-L10N-###` (unused; `FR-I18N`
collides with the legacy `NFR-I18N-001` in `docs/specs/target-architecture.spec.md:870`)

---

## 0. What actually exists — read this before anything else

Three of the premises this work is usually briefed with are wrong against `dev`. Each is corrected
here with the file that decides it.

### 0.1 ✅ Confirmed: there is no i18n framework, at all

- `pmo-portal/package.json:31-48` — no `i18next`, no `react-i18next`, no `lingui`, no `react-intl`,
  no `intl-messageformat`, no `typesafe-i18n`, no `paraglide`.
- Zero `.ts`/`.tsx` files import or reference any of them. Zero files named `*i18n*`, `*locale*`,
  `*translat*` exist anywhere in `pmo-portal/` or `supabase/`.
- `pmo-portal/index.html:3` — `<html lang="en">`, static.

Every user-facing string in the app is an English literal in source. **The brief is correct on this
point.**

### 0.2 ✅ Confirmed: `format.ts` hardcodes `en-US`/`USD` — in 18 places, not one

`pmo-portal/src/lib/format.ts` exports **21 functions** backed by **18 module-level `Intl`
singletons**. Fifteen construct with `'en-US'`, three with `'en-GB'`
(`src/lib/format.ts:223`, `:241`, and the `formatUtcDayMonthYear` part-join at `:247-251`).
Every money formatter welds `currency: 'USD'` (`:5`, `:105`, `:121`, `:133`). One welds a literal
`$` into a template string (`formatCompactCurrency`, `src/lib/format.ts:87-99`).

⚑ **The singletons are the mechanical problem, and they are the reason this is a real build rather
than a find-and-replace.** They are constructed at module import time, so no function in this file
can become locale-aware without changing its shape: each needs a factory keyed by
`(locale, currency)` with a cache, or the module needs a mutable "current locale" set before the
first render. 21 signatures change either way. That is the diff.

### 0.3 ❌ Correction: the currency half is **not** done. The DB half is done; nothing reads it

`0187_money_currency_seam.sql` shipped: `organizations.default_currency` (`:83`, NOT NULL,
ISO-4217-checked), a `currency` column on **12** PMO-owned money tables, and a `stamp_currency`
BEFORE-INSERT trigger that fills it from the org — the `stamp_org_id` idiom. `0196`/`0197` added the
tax treatment. That work is solid and this spec does not touch it.

But `OD-CR-5`'s ruling is *"formatting keyed off the record's currency, never a global constant."*
**The formatting half was never built.** `formatCurrency(value: number)`
(`src/lib/format.ts:12`) takes no currency argument, no record, and no context; a grep for a call
site reading `.currency` off a row and passing it to a formatter returns nothing. The column exists
and **not one line of frontend code reads it.**

So the seam is currently a column with no consumer. This spec's `FR-L10N-020..023` are what turn it
into a seam.

### 0.4 ❌ Correction: `DD-I18N-2`'s preference columns do not exist

`default_locale`, `default_number_locale`, `default_timezone` on `organizations`, and
`locale`/`number_locale`/`timezone` on `profiles` — **none exist.** The only occurrence of those
names anywhere in `supabase/migrations/` is a `⛔ TODO` block in
`0192_operator_create_org.sql:32-36`, which states the consequence plainly: *"DD-RIS-2 needs the RIS
org created with `id` / Indonesian number format / `Asia/Jakarta`; until #468 lands, this function
cannot state them and an operator must set them by hand afterwards."*

That TODO is a build instruction addressed to this spec: the columns must be added **and**
`operator_create_org` updated **in the same migration**, or the RIS org silently inherits `en`.

### 0.5 What #477 actually gave us — and what it did not

#477 (CLOSED) routed ~45 hardcoded-locale sites across ~28 files through `format.ts`, and added an
ESLint guard at `pmo-portal/eslint.config.js:86-98` — `no-restricted-syntax` banning
`.toLocaleString`/`.toLocaleDateString`/`.toLocaleTimeString` member expressions and `new Intl.*`
constructors outside the seam file.

**What that is worth: the display surface is now a chokepoint of one file with a fence around it.**
Before #477 this spec's build would have had to touch 28 files and would have leaked a new one the
week after. That is a genuine and large gift, and it is why this ticket is tractable.

**What it is not:** #477 introduced **no locale variable, no currency parameter, no user preference,
no provider, and no plural handling.** Its own commentary says so — `src/lib/format.ts:102`:
*"The locale seam (#468) will make these org/user-aware in ONE file."* It moved the problem to one
place; it did not solve any part of it. Every one of its 18 formatters is byte-identically as
`en-US`/`USD` as it was before.

**One exclusion carried forward:** `pages/project-detail/ProjectDetailHeader.tsx:75` holds a
deliberate `eslint-disable` for a masked money **input** grouping digits with
`toLocaleString('en-US')`. #477 excluded it on purpose and handed it to this ticket
(`DD-I18N-3` — *extract it, don't rewrite it*).

### 0.6 Summary table

| Piece | State | Evidence |
|---|---|---|
| i18n library | **absent** | `package.json:31-48`; zero imports |
| String catalogue / `t()` | **absent** | zero files |
| Display formatting funnelled to one file | **shipped** | `src/lib/format.ts`; guard `eslint.config.js:86-98` |
| Formatters are locale-aware | **absent** | 18 hardcoded `Intl` singletons |
| Formatters are currency-aware | **absent** | `formatCurrency(value: number)` — no currency param |
| `currency` on money rows | **shipped** | `0187`, 12 tables + trigger |
| Org/user locale preference columns | **absent** | `0192:32-36` ⛔ TODO |
| Locale resolution helper | **absent** | — |
| `<html lang>` reactive | **absent** | `index.html:3` static `"en"` |

---

## 1. Scope

Make the app render in Indonesian. Concretely: a message catalogue with a `t()` runtime, org- and
user-level locale/number-locale/timezone preferences, and `src/lib/format.ts` made locale- **and**
currency-aware so it reads the money row's own `currency` rather than a welded `USD`.

**In scope:** the mechanism, the preference storage and resolution, the currency-aware formatters,
the key convention, the CI completeness gate, and the extraction of English source strings into the
`en` catalogue.

**Out of scope:** the Indonesian *content* — writing the `id` translations is #450 step 6, and runs
last so it covers everything once (`OD-CR-3`). This spec ships `en` complete and `id` empty-but-wired.

**Explicitly untouched:** `0187`/`0196`/`0197` and the tax treatment (shipped); the export path
(`DD-I18N-4` — `src/lib/export/toWorkbookBuffer.ts` already writes typed cells and must not be
"improved"); the procurement importer's batch-scoped idempotency key.

---

## 2. The library decision

### `DD-I18N-1` already ruled this, and the ruling survives contact with the tree

The brief asks for a recommendation. **The decision was already made and recorded** — `DD-I18N-1`
(`docs/decisions.md:1335`, and in full on #468): **react-i18next, for message strings only; `Intl`
keeps money, dates and numbers.** Lingui was rejected for its Vite-8/React-19 babel-macro coupling;
a hand-rolled `t()` + context was rejected because at ~1,000+ strings the *tooling* (extraction,
missing-key report, CI gate) is the work, not the runtime.

I re-derived it against the tree and **I concur, on the same grounds plus one the ruling didn't
have**: the count is now measured at ~1,940 call sites / ~1,170 distinct strings (§3), which is at
the *top* of `DD-I18N-5`'s ~800–1200 estimate. Hand-rolling a catalogue at that size is not the
lazy option, it is the expensive one.

**In one line:** `react-i18next` + `i18next` at runtime, `i18next-parser` as a dev dependency for
extraction and the CI completeness gate; `Intl.PluralRules` for the two English plural forms
(Bahasa has no grammatical plural); **no `i18next-icu`, no formatting plugins, no `format`
interpolators** — the money path acquires no plugin dependency, ever.

### How it composes with `format.ts`

Cleanly, because the split is by *type of thing*, not by *place in the tree*:

- **i18next owns message strings.** `t('project.header.title')`. It never sees a number or a date.
- **`format.ts` owns every number, money figure and date.** It stays the single `Intl` seam behind
  the ESLint fence. It gains a locale input; it never gains a translation lookup.
- **Interpolation crosses the boundary in one direction only:**
  `t('budget.remaining', { amount: formatCurrency(row.amount, row.currency) })` — the *formatter*
  runs first and i18next interpolates the finished string. i18next is never asked to format.

That direction is load-bearing and is why the plugin ban is safe: an interpolator plugin is the
only thing that would make i18next want to format a number, and we do not install one.

### ⚑ The gap `DD-I18N-1` did not cover: `formatRelativeTime`

`src/lib/format.ts:75-81` produces English **prose** — "5 minutes ago" — via date-fns
`formatDistanceToNow`. It is a message string wearing a formatter's clothes. It is **not** covered
by i18next (no key exists) and **not** covered by `Intl` (it is date-fns, not `Intl.RelativeTimeFormat`).

`date-fns@4.4.0` ships `node_modules/date-fns/locale/id` — verified present. So the fix is a
`{ locale }` option, not a rewrite. It is one call site (`src/components/shell/NotificationBell.tsx:258`)
and it would otherwise ship an English phrase into an Indonesian notification inbox with every test
green.

### The dependency ask

Three packages: `i18next`, `react-i18next` (runtime, ~15kB gz combined), `i18next-parser` (dev).
This needs the owner's sign-off — see §8.

⚑ **`npm install` on macOS must not be used to add them.** `scripts/relock.sh` (regenerates the lock
in a `node:22` container) is the only correct route; a Mac-generated lock prunes the wasm32-wasi
optional deps and reddens `npm ci` in linux CI (CLAUDE.md, binding).

---

## 3. How big is the extraction job

**Method.** A regex scan (`scratchpad/final.mjs`, throwaway) over **195 non-test `.tsx`** files under
`pages/ components/ src/`, with block and line comments stripped, counting three shapes:

1. **JSX prose text nodes** — `>…<` spanning newlines, requiring ≥2 consecutive letters and
   rejecting anything containing `; = ( ) & |`, `=>`, `const`/`let`/`return`/`null`, or a leading
   `: , .` (those reject TS generics and ternary fragments that the naive regex otherwise swallows),
   plus a stop-list of generic type names (`Promise`, `React`, `Element`…).
2. **Label-bearing JSX props** — string or `{'…'}` values of `label · title · placeholder ·
   aria-label · ariaLabel · heading · description · emptyMessage · confirmLabel · cancelLabel ·
   submitLabel · alt · helpText · hint · message · actionLabel`.
3. **Object-literal label fields** — `label:`/`title:`/`description:`/`placeholder:`/`header:`/
   `helpText:`/`emptyMessage:` with a string value (this is where the column definitions, status
   maps and nav entries live).

Plus a narrower pass over **non-test `.ts`** files for multi-word literals in `message:`/`body:`/
`summary:`/`text:`/label fields (error copy, status maps).

**Result.**

| Shape | Occurrences |
|---|---|
| JSX prose text nodes | 605 |
| Label-bearing props | 942 |
| Object-literal label fields | 331 |
| `.ts` message/label literals | 66 |
| **Total call sites** | **~1,940** |
| **Distinct strings** | **~1,170** |

**Error bars, stated honestly.** This is a regex, not a parser. It **under**-counts: `name=` props
(171 more, mostly form field names but some are user-visible), object `text:` fields (14), any prose
split across a `{' '}` interpolation, and every `aria-*` attribute outside the whitelist. It
**over**-counts by a small margin — surviving TS-generic fragments and a handful of non-user-facing
`title=`/`label=` values (chart series ids, test hooks). Net: **~1,900 ± 15% call sites, ~1,150
distinct strings.** Both directions were sampled by eye; neither dominates.

**The concentration matters more than the total.** The top 20 files carry ~700 of the occurrences —
`pages/CompanyDetail.tsx` (78), `pages/ContactDetail.tsx` (59), `pages/ProjectBudget.tsx` (46),
`pages/project-detail/tabs/DocumentsTab.tsx` (45), `pages/project-detail/tabs/TasksTab.tsx` (45),
`pages/AdminUsers.tsx` (44) — and 54 of the 195 files have **zero**. This is not 195 evenly-hard
files; it is ~30 hard ones and a long tail.

**What this tells the owner about step 6.** ~1,150 distinct strings, most of them short UI labels,
is a **multi-week** translation content pass for one person working through a JSON file — not a day,
and not a month either. It is the largest single chunk of remaining go-live work after the mechanism
lands, and it is the part that can be done by someone who is not an engineer, in parallel with steps
2–4. It should be started as soon as the `en` catalogue is extracted, not deferred to step 6's slot.

---

## 4. Requirements (EARS)

### Preferences and resolution

- **FR-L10N-001** — *Ubiquitous.* `organizations` shall carry `default_locale text not null default
  'en'`, `default_number_locale text` (nullable; NULL = derive from `default_locale`), and
  `default_timezone text not null default 'Asia/Jakarta'` (`DD-I18N-2`).
- **FR-L10N-002** — *Ubiquitous.* `profiles` shall carry `locale text`, `number_locale text` and
  `timezone text`, **all nullable, where NULL means inherit from the org** (`DD-I18N-2`).
- **FR-L10N-003** — *Ubiquitous.* Locale resolution shall occur in exactly **one** helper,
  `resolveLocale(profile, org)`, and never as scattered `?? org.x` at call sites.
- **FR-L10N-004** — *Event-driven.* When a user chooses "reset to organization default", the system
  shall write **NULL** to the profile column — never a copy of the org's current value.
- **FR-L10N-005** — *Ubiquitous.* `public.operator_create_org` shall accept and set
  `default_locale`, `default_number_locale` and `default_timezone` as **required parameters with no
  defaults**, in the same migration that adds the columns (`0192:32-36`; same reasoning as
  `default_currency` and `tax_treatment` — omission must be a hard error, not a plausible-looking
  wrong value).
- **FR-L10N-006** — *Ubiquitous.* A user shall be able to read and set their own three preference
  columns and no one else's; org defaults shall be operator-settable only (matching
  `default_currency`'s posture — `organizations` carries a SELECT policy only).

### Formatting

- **FR-L10N-010** — *Ubiquitous.* Every formatter in `src/lib/format.ts` shall resolve its locale
  from the resolved preference rather than a hardcoded literal. No `Intl` constructor anywhere in
  the codebase shall name a locale literal.
- **FR-L10N-011** — *Ubiquitous.* `Intl` formatter instances shall be memoized per
  `(locale, currency, shape)` — the current module-level singletons are constructed at import time
  and cannot be reused as-is.
- **FR-L10N-012** — *Ubiquitous.* `formatRelativeTime` shall pass a date-fns locale object matching
  the resolved locale (`date-fns/locale/id` for `id`), so relative timestamps are not English prose
  in an Indonesian UI.
- **FR-L10N-013** — *Ubiquitous.* The ESLint `no-restricted-syntax` guard at
  `eslint.config.js:86-98` shall be **extended**, not relaxed, to also reject a string-literal locale
  argument inside `src/lib/format.ts` itself.
- **FR-L10N-014** — *State-driven.* While the app is rendering, `document.documentElement.lang`
  shall equal the resolved locale (`index.html:3` is static today).

### Currency (closing `OD-CR-5`'s open half)

- **FR-L10N-020** — *Ubiquitous.* Every money formatter shall take the **record's** `currency` as an
  argument. `formatCurrency(value)` becomes `formatCurrency(value, currency)`.
- **FR-L10N-021** — *Ubiquitous.* Number grouping and decimal separators shall key off
  `number_locale`, and the currency symbol off the record's `currency` — the two are independent
  (an `id-ID` user may legitimately view a USD invoice).
- **FR-L10N-022** — *Ubiquitous.* `formatCompactCurrency` (`src/lib/format.ts:87-99`) shall stop
  welding a literal `$` and stop hardcoding the `K`/`M` tier labels; compact notation is
  locale-specific (`id-ID` renders "jt" for millions, not "M").
- **FR-L10N-023** — *Ubiquitous.* Platform AI billing figures (`agent_usage.cost`,
  `provider_cost_usd`, `credits.amount`) shall remain **USD**, explicitly, and shall not follow the
  org currency — `0187`'s header excluded them for exactly this reason and a locale-aware formatter
  is the obvious place to re-introduce the bug.

### Parsing (the thousandfold risk)

- **FR-L10N-030** — *Ubiquitous.* `parseMoneyInput` (`src/lib/format.ts:27`) shall parse according to
  the resolved number locale, and shall remain the **single** parse behind both validation and
  persistence (Wave 3 invariant, restated by `DD-I18N-3`).
- **FR-L10N-031** — *Ubiquitous.* The masked money input at
  `pages/project-detail/ProjectDetailHeader.tsx:67-81` shall be **extracted** into a shared
  locale-aware component and reused by all six `parseMoneyInput` call sites in one pass
  (`ProjectFormModal`, `BudgetProjection`, `ProjectBudget`, `VendorQuotesTab`, `LineItemsSection`).
  The component owns display grouping; the parse stays the boundary.

### Catalogue

- **FR-L10N-040** — *Ubiquitous.* Catalogues shall live at `pmo-portal/public/locales/{en,id}/<ns>.json`,
  namespaced by feature, generated from source by `i18next-parser` (`DD-I18N-5`). `public/` exists.
- **FR-L10N-041** — *Ubiquitous.* A missing key shall render the **English source string** — never the
  raw key, never a visible marker. A client must not be shown `project.header.title`.
- **FR-L10N-042** — *Ubiquitous.* A missing **or orphaned** key shall fail CI, as a step in
  `npm run verify`. The forgiving runtime of FR-L10N-041 is affordable *only* because this gate
  makes gaps unshippable; the two rulings work as a pair or not at all.
- **FR-L10N-043** — *Ubiquitous.* Locale bundles shall load lazily per locale, so an `en` session
  never downloads the `id` catalogue. (`vite.config.ts:135` already routes vendor chunking through
  the tested `vendorChunkFor`; catalogues are fetched JSON, not bundled.)

### Exports (restating the prohibition so it is testable here)

- **FR-L10N-050** — *Ubiquitous.* No export value shall pass through `formatCurrency`, `formatDate`
  or `t()`. xlsx writes typed cells; CSV is neutral (`.` decimal, no grouping, ISO dates); API
  payloads, logs and filenames stay ISO 8601 and raw numbers (`DD-I18N-4`).

---

## 5. Acceptance criteria

- **AC-L10N-001** — *Given* a profile with `locale = NULL` in an org whose `default_locale` is `id`,
  *when* the app renders, *then* the UI is Indonesian; *and* when the org flips to `en`, that user
  follows.
- **AC-L10N-002** — *Given* a profile that explicitly stored `locale = 'en'` in an org whose
  `default_locale` is also `en`, *when* the org flips to `id`, *then* that user **stays** English.
  *(This is the whole reason NULL-means-inherit was chosen over copy-the-default-down; a design that
  copies at insert passes AC-L10N-001 and fails this one.)*
- **AC-L10N-003** — *Given* a user choosing "reset to organization default", *when* it is saved,
  *then* the stored column is NULL, not the org's value.
- **AC-L10N-004** — *Given* a call to `operator_create_org` omitting `default_locale`, *when* it
  executes, *then* it raises — it does not create a silently-`en` org.
- **AC-L10N-005** — *Given* a non-Admin user, *when* they attempt to write another profile's
  `locale`, *then* RLS denies it.
- **AC-L10N-010** — *Given* the string `'1.234'` typed into a money field, *when* the resolved number
  locale is `id-ID`, *then* it parses to **1234**; *and when* it is `en-US`, *then* it parses to
  **1.234**. One string, two correct answers, a factor of a thousand apart.
- **AC-L10N-011** — *Given* a value table spanning negatives, zero, sub-unit and >1e9 magnitudes,
  *when* round-tripped per locale, *then* `parse(format(n)) === n` and `format(parse(s)) === s` for
  both `en-US` and `id-ID`.
- **AC-L10N-012** — *Given* the separator handling in `parseMoneyInput` is deliberately broken,
  *when* the money suite runs, *then* it goes **red**. *(Mandatory mutation check, CLAUDE.md.)*
- **AC-L10N-020** — *Given* an invoice row whose `currency` is `IDR` viewed by an `en-US` user,
  *when* rendered, *then* the symbol is the row's IDR and the grouping is the viewer's `en-US` —
  the two are independent.
- **AC-L10N-021** — *Given* an agent-usage cost row, *when* rendered in an IDR org, *then* it is
  still formatted as **USD**. *(FR-L10N-023 — the re-denomination trap.)*
- **AC-L10N-022** — *Given* a compact currency value of 2,500,000 in an `id-ID` locale, *when*
  rendered, *then* it uses the Indonesian compact unit, not a welded `$` and `M`.
- **AC-L10N-030** — *Given* a notification timestamp, *when* rendered under `id`, *then* the
  relative phrase is Indonesian, not "5 minutes ago".
- **AC-L10N-031** — *Given* the resolved locale is `id`, *when* the app renders, *then*
  `document.documentElement.lang === 'id'`.
- **AC-L10N-040** — *Given* a key present in `en` and absent from `id`, *when* rendered under `id`,
  *then* the English source string appears — never the key.
- **AC-L10N-041** — *Given* a key present in `en` and absent from `id`, *when* `npm run verify` runs,
  *then* it **fails**.
- **AC-L10N-042** — *Given* a catalogue key that no source file references, *when* `npm run verify`
  runs, *then* it fails as an orphan.
- **AC-L10N-043** — *Given* an `en` session, *when* the network log is inspected, *then* no `id`
  catalogue was fetched.
- **AC-L10N-050** — *Given* a workbook export of money and dates, *when* the file is inspected,
  *then* `cell.value` holds a **number** and a **Date**, not a formatted string, in every locale.
- **AC-L10N-051** — *Given* a CSV export under `id-ID`, *when* parsed, *then* decimals use `.`, no
  grouping is present, and dates are ISO.
- **AC-L10N-060** — *Given* a user switches language in the UI, *when* the page settles, *then* a
  money figure and a date both render in Indonesian convention on the same screen.
- **AC-L10N-061** — *Given* every unit and e2e test asserting formatted output, *when* the suite runs
  under a runner whose default locale is **not** `en-US`, *then* it still passes. *(Pins are
  explicit; nothing inherits the environment.)*

---

## 6. Traceability (ADR-0010 — one owning layer per AC)

| AC | Owning layer | Location |
|---|---|---|
| AC-L10N-001/002/003 | Unit (Vitest) | `resolveLocale` tests — pure logic, three preferences × two fallback rules |
| AC-L10N-004 | Integration (pgTAP) | `operator_create_org` required-parameter proof |
| AC-L10N-005 | Integration (pgTAP) | profile-preference RLS write contract |
| AC-L10N-010/011/012 | Unit (Vitest) | `format.test.ts` — the value table + the mutation battery |
| AC-L10N-020/021/022 | Unit (Vitest) | `format.test.ts` currency-argument cases |
| AC-L10N-030/031 | Unit (Vitest / RTL) | `formatRelativeTime` locale option; `lang` attribute effect |
| AC-L10N-040 | Unit (Vitest) | i18next fallback configuration |
| AC-L10N-041/042 | **CI gate** | `i18next-parser` completeness step in `npm run verify` |
| AC-L10N-043 | Unit (Vitest) | lazy-load backend config assertion |
| AC-L10N-050/051 | Unit (Vitest) | `toWorkbookBuffer` typed-cell + CSV neutrality guards |
| AC-L10N-060 | **E2E (Playwright)** | `e2e/AC-L10N-060-language-switch.spec.ts` — the one curated cross-stack journey; nothing else here is cross-stack |
| AC-L10N-061 | **CI gate** | runner locale pinned away from `en-US` in the verify job |

---

## 7. Traps this work will hit

**⚑ 1. The 65 tests that assert `$`-prefixed en-US output — the largest single risk.**
Measured against `dev`: **56 non-test-excluded unit test files** match `$<digit>`, `M/D/YYYY` or
`Mon D, YYYY` patterns, and **9 of the 79 e2e specs** do. (`DD-I18N-6` said 48 and 11; the unit count
has grown, the e2e count shrunk — read the tree, not the ticket.) Every one must pin an **explicit**
locale rather than inherit the runner's or the browser's. Left implicit they either go red for the
wrong reason — or **stay green while proving nothing**, because the runner happens to default to
`en-US` on our machines and in CI. That is a suite certifying a locale nobody chose. `AC-L10N-061`
exists to make the omission detectable.

**⚑ 2. Date/number formatting is not string translation, and mixing them is how the money path
acquires a plugin.** Two different mechanisms, two different owners, one direction of travel
(`format.ts` → `t()`, never back). The moment someone reaches for `i18next-icu` to format an amount
inside a message, the money path has a formatting dependency it was explicitly denied. `FR-L10N-050`
and the plugin ban are the fence.

**⚑ 3. `formatRelativeTime` is a message string wearing a formatter's clothes.** §2 covers it. It
will pass every type check and every existing test while rendering English into an Indonesian inbox.

**⚑ 4. The `en-GB` formatters and the hand-joined parts.**
`formatDayMonth` (`:223`) and `formatUtcDayMonthYear` (`:241-251`) hardcode `en-GB`, and the latter
calls `formatToParts` and **manually reassembles** `day month 'year`. Under `id-ID` the part set and
their order differ; the manual join produces a string that is grammatically wrong but *renders*, so
nothing fails. These two are used on the S-curve axis and milestone chips.

**⚑ 5. Chart axes are gate-tested, so formatter changes redden the visual portfolio.**
ADR-0030 §C makes chart-position and Playwright visual-regression Layer-1 gate tests. `sCurve.ts`,
`monthMatrix.ts` and the milestone strip all render through axis formatters this spec changes.
Expect visual snapshots to need re-baselining — and expect that to be indistinguishable, at first
glance, from a real regression. Re-baseline deliberately, one formatter at a time.

**⚑ 6. Locale-aware sorting: 11 `localeCompare` call sites, and most of them must NOT change.**
Of the 11 (`grep -rn localeCompare src pages components`), the majority sort **ISO date strings**
(`timesheet-derive.ts:58`, `procurement-summary.ts:61`, `timeLogPacking.ts:61`) or **UUIDs**
(`erpSnapshots.test.ts`, `revenue.test.ts`) — passing a locale to those is at best a no-op and at
worst reorders a stable machine ordering. Only the two sorting **human names** should become
locale-aware: `ganttLayout.ts:246` and `Timesheets.tsx:145`. A blanket sweep here is a regression
dressed as thoroughness.

**⚑ 7. RTL: explicitly not in scope, and the reason is not "later".**
Indonesian is written left-to-right in Latin script. Nothing in the go-live scope needs RTL, and
building a `dir` seam now means adding logical-property CSS and mirrored-icon rules across a design
system whose tokens (`DESIGN.md`) have no RTL vocabulary — cost paid now, value realized never, or
at least not before a market that has not been named. `FR-L10N-014` sets `lang` and not `dir`
deliberately. If Arabic or Hebrew is ever scoped, that is a separate ticket with its own design
round, and the `lang` plumbing this spec lays is where `dir` would attach.

**⚑ 8. Do not "fix" the export path.** `toWorkbookBuffer.ts` already got this right — typed cells,
locale-independent format codes, rendered in the *reader's* locale. A well-meaning agent seeing an
i18n ticket will localize it. A formatted string in a spreadsheet cell is precisely the thousandfold
corruption this program exists to prevent.

**⚑ 9. `stamp_currency`'s trigger name is load-bearing** (`<tbl>_zz_stamp_currency`, alphabetical
firing order after `stamp_org_id`). Any new preference-stamping trigger added by this work must not
sort between them.

**⚑ 10. The `0192` TODO is a two-part instruction.** Adding the columns without updating
`operator_create_org` in the same migration leaves the RIS org inheriting `en` — which is the exact
failure mode the TODO was written to prevent, and it will not raise.

---

## 8. ⏸ Needs an owner ruling

**8.1 — The dependency.** This adds three npm packages: `i18next` and `react-i18next` (runtime,
~15kB gzipped combined) and `i18next-parser` (dev-only, for extraction and the CI gate). No other
i18n plugin, now or later — the money path stays plugin-free by rule. The alternative is a
hand-rolled `t()` plus a JSON loader (~40 lines, zero dependencies), which at ~1,150 distinct
strings across 195 files means hand-building key extraction, a missing-key report and a fallback
policy — the parts the parser gives us as a CI gate. **Approve the three packages?**

**8.2 — Go-live language scope.** `DD-I18N-2` gives every user a personal override, so English stays
reachable per-user even in an `id` org. Two things follow that need your call:
 (a) Does the client's org ship with English **available** to their users (a language switcher in
     settings), or is `id` the only language they can select?
 (b) Does the `id` catalogue have to be **100% complete** to go live, or is silent-English fallback
     acceptable for rarely-seen surfaces (operator admin screens, error states)? The CI gate
     (`FR-L10N-042`) enforces whichever answer you give; it currently assumes 100%.

**8.3 — Who translates ~1,150 strings, and when do they start?** Not an engineering question and it
does not gate the mechanism, but it is the longest pole after this ships. `DD-I18N-5` ruled **no
TMS** (no Crowdin/Lokalise for two languages), so the mechanism accepts either a direct JSON edit or
a spreadsheet round-trip and the translator needs no tooling. The sequence (#450) puts the content
pass at **step 6**, after work orders. My recommendation is to **start it as soon as the `en`
catalogue is extracted** — it is unblocked from step 2 onward and runs in parallel with steps 2–4,
whereas leaving it in slot 6 serializes multiple weeks of non-engineering work behind engineering
work that does not depend on it. **Keep it at step 6, or start it early in parallel?**
