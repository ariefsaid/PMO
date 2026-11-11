# PMO UX standard

Machine-checked, must pass, not restated below: Impeccable detector (signed in, 1440 + 390; owner ignores in `.impeccable/config.json`), axe-core serious/critical, no horizontal page scroll, phone targets ≥ 44px, one h1, token-only colours. Judgment: one fresh, independent Impeccable + Taste critique per job. A rule may be broken only with a written reason. Each line: **rule** — *check*.

## Page anatomy
- **PA1** Every page stacks title → scope (project, customer, date, period) → toolbar → content → action bar, all on one left edge; empty slots are omitted, never reordered. — *Slots appear in this order and align at 1440 and 390.*
- **PA2** Each page is one type (collection, record, capture, review queue, dashboard, settings, sign-in) and uses that type's anatomy. — *Same type, same skeleton across areas.*
- **PA3** Content fills the content track (max 1280px); no narrow centred column outside sign-in. — *No empty band wider than 25% beside content at 1440.*
- **PA4** On capture pages at 390 the first entry row starts in the top half of the screen; explanations go below the work or behind a disclosure. — *First input top ≤ 422px at 390×844.*

## Navigation
- **NV1** Where you are is always visible: active menu item and a page title matching it; records add a breadcrumb. — *Active item highlighted; title = menu label.*
- **NV2** Every child or record page has a visible way back to its parent. — *Back link or breadcrumb present.*
- **NV3** Tabs only switch 2–3 views of one job, never separate jobs. — *No tab set mixing jobs.*
- **NV4** Filters, sort, tab and selected record live in the URL; reload and Back keep them. — *Reload restores the same view.*
- **NV5** Each object has one home page; elsewhere it is linked, not re-listed as a second copy. — *No duplicate list of the same object.*

## Actions
- **AC1** One filled primary action per view. — *At most one filled button visible.*
- **AC2** Primary sits top-right of the title row on desktop collections and records; on capture pages and on phone it sits in the bottom action bar. — *Primary in its slot.*
- **AC3** Buttons name their result in sentence case ("Submit 3 entries", "Save item"). — *No bare "OK", "Submit", "Click here".*
- **AC4** Icon-only buttons only for universal icons (close, search, menu, back); a primary action always shows text. — *No unlabelled primary icon.*
- **AC5** Irreversible actions confirm with the real consequence; reversible routine actions offer undo instead of a confirm. — *Confirm text names what is lost.*
- **AC6** A disabled action shows why, next to it. — *Every disabled primary has a visible reason.*

## Entry and forms
- **EN1** Labels sit above fields and stay visible; placeholders only show an example. — *Every field has a visible label.*
- **EN2** Quantities show their fixed unit beside the field. — *No quantity without a unit.*
- **EN3** Field width fits the expected value. — *No full-width field for a short number or date.*
- **EN4** Number fields open the numeric keyboard and use ≥ 16px text on phone. — *inputmode set; font-size ≥ 16px at 390.*
- **EN5** One save model per screen, stated: autosave shows Saving / Saved / Error per field; batch screens have one submit naming what posts. — *Never both unlabelled on one screen.*
- **EN6** Errors appear next to the field, name the problem and the fix, and keep what was typed. — *Error adjacent; value retained.*
- **EN7** Leaving with unsaved input asks first; Escape cancels an edit and restores the saved value; Enter/Tab move to the next entry. — *Keyboard and leave-guard pass.*

## Collections and tables
- **CT1** The toolbar sits above the data, left-aligned: search, then filters, result count at the right; active filters show as removable chips. — *Toolbar order and chips.*
- **CT2** "No matches" (filters) looks and reads different from "no data yet". — *Both states distinct.*
- **CT3** A default sort is chosen for the job and shown; sortable headers show direction. — *Sort indicator visible.*
- **CT4** Columns: identity first, then status, owner, dates; numbers last, right-aligned, tabular figures. — *Order and alignment.*
- **CT5** Headers carry field names; rows never repeat labels (phone rows use one muted meta line). — *No per-row labels on desktop.*
- **CT6** Clicking a row opens it; other row actions sit at the row's end, the same on every collection. — *Consistent row actions.*
- **CT7** Group headers show a count; collapsing is a real button. — *Count and button present.*
- **CT8** Empty values are blank or "—", never a wall of "Not set". — *At most one placeholder value per row.*

## Status and data
- **SD1** One status vocabulary everywhere: red = error, overdue, failed; amber = needs attention, waiting; green = done, posted; blue = in progress, selected; grey = inactive; always word + colour (+ icon), never colour alone. — *Same status, same look on every page.*
- **SD2** Exceptions show without opening anything, with their size ("Overdue · 5 days", "3 missing"). — *Exception visible in the list.*
- **SD3** Money is "Rp 1.234.567"; short forms ("Rp 1,3 M", "35,1 jt") only in summaries. — *One format per context.*
- **SD4** Dates and times in WIB: "Mon 12 Oct" in lists, full date and time on records; relative time only beside an absolute one. — *One format per context.*
- **SD5** Unknown or missing shows "—" with the reason; imported figures show their freshness ("Sales through Mon 5 Oct · synced 02:05"); never a made-up 0. — *No missing value shown as 0.*
- **SD6** A chart answers one question and labels units and comparison basis, or is left out. — *Axes, units, basis labelled.*

## States
- **ST1** Every data view designs loading (skeleton, no jump), empty (says what will appear and what to do), error (what failed + retry), partial, and no access (why + who to ask). — *Each state rendered.*
- **ST2** Offline is honest: drafts are called drafts, never "saved"; network-only actions are disabled with the reason. — *Offline copy.*
- **ST3** Every action responds within a second: busy state on the control, then a result message near it. — *No silent submit.*

## Language and copy
- **LC1** Words follow CONTEXT.md, the same word for the same thing on every page, in EN and ID; Indonesian fits without clipping. — *Glossary terms; ID screenshots unclipped.*
- **LC2** Sentence case everywhere; no uppercase tracked labels, eyebrows or kickers. — *No uppercase text-transform on labels or headings.*
- **LC3** At most one short line of description under a title; no prose that repeats the title or the obvious. — *≤ 1 description line.*

## Access
- **AX1** Show only what the role can see; what it can see but not do now is disabled with the reason. — *Per-role screenshots differ correctly.*
