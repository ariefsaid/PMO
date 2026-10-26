# Page templates and pattern catalogue

Composition companion to [UX-STANDARD](UX-STANDARD.md); [area briefs](areas/) supply route/persona jobs; rendered owner approval decides the result (OD-VISUAL-RESET / OD-UX-HIERARCHY).
Owner diagnosis: "there is no structure to the data and how to emphasize importance using text sizing, spacing, boldness; the structure is incoherent and unintuitive."
Use these templates before choosing components; each figure/fact has one home. No new colours, fonts or radii; [DESIGN.md](../../DESIGN.md) supplies tokens only.

## Shared type, rhythm and acceptance

Exactly five product type roles; one family (`typography.fontFamily`), fixed rem sizes at the 16px root; no fluid type or per-route variants. Head/label/value differ in both size and weight.

| Role / shorthand | DESIGN.md token | Size / weight |
|---|---|---|
| Page title / P | `typography.page-title` | 1.5rem / 700 |
| Section head / H | `typography.heading` | 1.25rem / 700 |
| Label / L | `typography.label` | 0.75rem / 600 |
| Value/body / V | `typography.body` | 0.875rem / 400 |
| Metadata / M | `typography.overline` | 0.6875rem / 600 |

Scale check: target adjacent-step ratio 1.125–1.2; existing tokens do not meet it (14→20 = 1.429, 11→12 = 1.091). Preserve tokens for this catalogue; strict ratio conformance requires a separately approved token-sheet revision, never local size overrides.
Numeric values use tabular numerals; money columns align right. Identity wraps in full; never ellipsis, line-clamp or hover-only recovery.
Put the primary figure/fact in the first section head H (topic + compact figure); its exact/detail rows use V. Secondary facts stay in V rows; no sixth hero-number role or repeated KPI summary.
Rhythm uses `spacing.base` (4px): tight = 2× (8px) within a fact; normal = 4× (16px) between related facts; generous = 8× (32px) between topics. Above a section head: generous; below: normal; never one gap everywhere.
Group by proximity first; at most one content-container level per page, no nested cards; cards never arrange the page. Declare elevation once: border via `colors.border` for content, shadow only for floating overlays, never both on one surface.
Accent only for the one primary action, current selection and meaningful state; existing focus ring remains. No decorative coloured KPI accents.
Every template passes the squint test at both widths: blurred, primary element → secondary element → major groups remain identifiable in that order.

## Six page templates

Ordered blocks below use 1440×900 and 390×844; **FV** = first viewport, before scrolling; retain the PA-00 answer when identity/localization wraps. Shell = area bar + global navigation (drawer at 390); navigation below means the single local layer.

### Collection — find and open

1. **1440 FV:** shell → named return → title/scope → C-01 toolbar → first result identity + PA-00 decision fact (e.g. outstanding) + Open.
2. **1440 below:** remaining rows → pagination → optional export/detail feedback; no KPI band before results.
3. **390 FV:** shell → return/title/scope → search → Filters + visible sort/view + More + creation → first identity/status/key amount/Open.
4. **390 below:** compact result rows → pagination; secondary row facts behind named detail, never a tall fact stack.
5. **Default collapsed:** extra filters, More actions, row details. **Navigation:** canonical record links; view chooser changes this same working set, no section tabs.
6. **Action bar:** creation ends toolbar; bulk bar replaces toolbar actions only after selection; row writes remain separate and quiet.

### Record — understand one object

1. **1440 FV:** shell → return → full identity/status + record primary → scope → section index beside content → PA-00 figure/fact + adjacent decision evidence.
2. **1440 below:** selected section's evidence → related records → named details/activity; sections use space + heads, no empty side rail.
3. **390 FV:** shell → return → full identity/status/scope → record primary row → current section/Sections control → PA-00 figure/fact.
4. **390 below:** evidence → related records → details; on scroll sticky identity + current section remain, without a second action row.
5. **Default collapsed:** identifiers/classification, provenance detail, historical breakdowns. **Navigation:** one named section index; phone Sections sheet replaces it, never adds tabs.
6. **Action bar:** non-decision record primary in title at 1440 / after scope at 390; review/capture within a section transfers primary to its footer after evidence.

### Capture — enter and save

1. **1440 FV:** shell → return/title → inherited project/customer/period → PA-00 identity or draft amount → first required field group, labels above inputs.
2. **1440 below:** remaining required groups → optional detail → totals/consequence → validation → Cancel + Save object.
3. **390 FV:** shell → return/title/scope → same identity/draft fact → first required inputs; no separate summary card or wizard menu.
4. **390 below:** field groups in task order → review/totals → action bar; two-column field grids reflow by business group, values survive collapse/error.
5. **Default collapsed:** optional classification, vendor/advanced detail; required or invalid fields auto-open. **Navigation:** named return only; no parallel section tabs.
6. **Action bar:** after review/evidence at both widths; phone stays in flow above safe-area clearance, never hides last input or keyboard-focused field.

### Review queue — choose, inspect, decide

1. **1440 FV:** shell → title/role scope → C-01 toolbar/oldest-first sort → queue beside selected request identity/status/PA-00 amount or hours.
2. **1440 below:** selected lines + requester/context + evidence → consequence/reason → decision bar; queue scroll and selection stay intact.
3. **390 FV (queue):** shell → title/scope → compact narrowing/sort → first waiting request identity/status/key amount/Open; no queue-count tile.
4. **390 FV (selected):** Back to queue → full request identity/scope → PA-00 amount/hours/status → start of evidence; remaining evidence then decision bar below.
5. **Default collapsed:** completed history, operational detail, provenance detail; never decision prerequisites. **Navigation:** queue selection in URL; phone selection replaces queue, Back restores it.
6. **Action bar:** follows complete selected evidence at both widths; one Approve object primary, quieter Return/Reject with reason/consequence; no list-level blind approval.

### Dashboard — choose the next intervention

1. **1440 FV:** shell → title/role scope → relevant period/basis controls → PA-00 next-case/primary figure → first exception or work row + next action.
2. **1440 below:** ordered decision groups → comparisons/trends → secondary evidence; use full tracks or meaningfully sized columns, no equal-card wall.
3. **390 FV:** shell → title/scope/compact controls → same primary answer → first actionable row (or known-clear/unavailable state); no chart/menu wall ahead.
4. **390 below:** compact figures → work rows → same-form charts/tables → secondary disclosures; preserve the desktop reading priority.
5. **Default collapsed:** purchasing breakdown, accounting diagnostics, measurement definitions unless they are this persona's PA-00 job. **Navigation:** canonical drill links, no dashboard tab hierarchy.
6. **Action bar:** one next action beside/after its evidence, never a detached floating bar; Engineer logs hours after dated hours/status; settled read-only views may have none.

### Settings — inspect saved choices, change one

1. **1440 FV:** shell → return/title/scope → named settings index beside selected topic → PA-00 saved value/readiness + permitted Edit/Connect.
2. **1440 below:** related saved choices → active editor → effect preview/consequence → Save object/Cancel → advanced detail.
3. **390 FV:** shell → return/title/scope → current topic/Settings sections control → saved value/readiness + named edit entry; first choice before diagnostics.
4. **390 below:** remaining choices → in-context editor → action bar → advanced detail; a directory body uses collection rows, not extra tiles.
5. **Default collapsed:** section chooser on phone, advanced fields, configured connection/history detail. **Navigation:** one named settings index; phone chooser replaces desktop index.
6. **Action bar:** active editor footer after fields/effect; immediate switches save beside the setting with pending/saved feedback, no artificial page Save.

## Molecules

Text references H/L/V/M resolve to the five tokens above; each molecule uses at most three levels. Synthetic name **N48** = “Pembangunan Gedung Layanan Terpadu Tahap IV Baru” (48 characters); money fixture = **IDR 2,226,648,000**.
State keys: D default; Hov hover; F focus; X disabled; Sk loading skeleton (same geometry); Err error; Ø empty; Long long content; ID localized (+30% label length). Every state below needs route evidence; static molecules explicitly have no interactive Hov/F/X.

### KPI tile

- **1440:** only earns a tile for a persona's PA-00 primary figure; max four per page, no supporting-stat/accent template. **390:** two-column compact figure grid; long exact value spans both columns once.
- **Text:** head H, label L, value V; first position and generous separation. Example: “Still to invoice · IDR 2.23 bn” / “Exact remaining” / “2,226,648,000”; exact visible, no supporting-stat/accent or duplicate total elsewhere.
- **States:** D scoped figure; Hov/F only on a named drill link; X link reason adjacent; Sk same label/value slots; Err unavailable + Retry; Ø known zero only; Long exact amount full-width; ID wraps labels, fixed roles.

### Fact list

- **1440:** maximum four label/value pairs per topic; five or more become a two-column fact grid or a table, never consecutive mini-lists to evade the limit. **390:** paired columns or sticky-identity table; no one-column label/value stack.
- **Text:** head H, labels L, values V; group head holds unit/currency/tax basis and any applicable shared caveat once. Example: “Billing · IDR · excl. PPN” → Billed / 2,226,648,000; Received / 1,780,000,000; Remaining / 446,648,000.
- **States:** D aligned pairs; Hov/F/X none for static facts; Sk preserves rows; Err unavailable linked to one scoped remedy; Ø “No billing yet”; Long N48 wraps without truncation; ID labels wrap within their cells.

### Money cell

- **1440:** whole-unit display by default; compact group head “IDR 2.23 bn”, exact row “2,226,648,000”; right-aligned, tabular. **390:** full-width exact amount line, no digit wrapping or smaller font to fit.
- **Text:** head H, label L, exact value V; currency once in a single-currency group head, explicit ISO code per row in mixed tables. Multi-currency uses separate currency rows/totals, never a cross-currency sum.
- **States:** D exact; Hov/F/X none unless a separate named detail control; Sk reserves amount width; Err “Not available”; Ø known 0; Long 13-digit figures retain full line; ID locale separators, same precision/basis.

### Status chip

- **1440:** quiet dot + words beside identity; date outside chip. **390:** wrap beside/below identity, never replace the name. **Text:** surrounding head H, chip label L, date/context V. Example: “Awaiting approval” / “26 Oct 2026”.
- **States:** D named status; Hov/F/X none on passive chip (separate control for transitions); Sk same footprint; Err “Status unavailable”; Ø “Not started” only if known; Long wraps label; ID expands without clipped pill; never colour alone.

### Section head

- **1440:** left-aligned topic + shared scope, quiet verb/object control at end. **390:** control wraps below scope; generous above, normal below. **Text:** head H, scope L, optional figure V. Example: “Billing · IDR · excl. PPN” + “View invoices”.
- **States:** D named topic; Hov/F on control; X adjacent reason; Sk keeps head/scope geometry; Err affected scope + Retry; Ø head + compact state; Long N48 wraps; ID control wraps, no competing primary.

### Disclosure

- **1440:** one toggle per topic, summary count/key figure in the toggle; body follows inline. **390:** same topic/summary, full-width 44px target; no nested disclosures. **Text:** head H, toggle label L, summary/body V. Example: “View invoices · 8 · IDR 2,226,648,000”.
- **States:** D closed per template; Hov quiet response; F visible ring + keyboard expand; X reason beside toggle; Sk same summary slot; Err summary unavailable + Retry; Ø “View invoices · 0”; Long summary wraps; ID +30%; expanded state exposes body, collapse retains values/focus.

### Toolbar

- **1440:** C-01 search → scope/filters → sort → view → secondary → creation. **390:** search full width; Filters/sort/view compact controls; secondary in More actions, creation last; applied scope remains visible. **Text:** optional head H, labels L, query/selected values V; N48 search value remains editable in full.
- **States:** D visible sort/scope; Hov/F controls respond/ring; X explains unavailable action; Sk same controls/geometry; Err keep inputs + Retry; Ø no-match keeps controls + Clear filters; Long query scrolls within input; ID wraps groups in DOM order; selection shows count/bulk actions.

### Action bar

- **1440:** after evidence, Cancel/secondary then one verb/object primary. **390:** same order in flow, 44px targets + bottom clearance, never overlay content. **Text:** evidence head H, control labels L, reason/outcome V. Example: “Approve invoice” after IDR 2,226,648,000 and consequence.
- **States:** D eligible next action; Hov/F visible response/ring; X reason beside control; Sk initial permissions use same slots; pending retains width + names operation; Err retained input + retry; Ø no invented action; Long N48 wraps in consequence; ID buttons wrap without covering evidence.

### Progress bar

- **1440:** label current and target beside a shared-scale track. **390:** labels above full-width track, same scale. **Text:** head H, target label L, current V. Example: “Delivery” / “Target 100% by 31 Dec 2026” / “Completed 67%”; budget target includes currency/basis.
- **States:** D labelled current/target; Hov/F/X none for static track; Sk same track; Err unknown track + reason, never 0%; Ø no baseline named; Long dates/targets wrap; ID labels expand; over-target value stays explicit even if track caps at 100%.

### Caption / provenance

- **1440:** one line per group, source + as-of once; named “View source details” opens extra evidence. **390:** short one-line summary + named control, no clipped meaning. **Text:** owning head H, details label L, caption M. Example: “Ledger · as of 26 Oct 2026”; details hold rate/basis/coverage.
- **States:** D dated source; Hov/F details control; X reason adjacent; Sk same line; Err “Source unavailable” + Retry; Ø “No saved snapshot”; Long move detail behind control, never ellipsis; ID shorten complete copy to one line; freshness differs by source only when necessary.

### Notification badge

- **1440:** quiet count attached to named bell, separate from approval queue. **390:** same count and 44px bell target. **Text:** panel head H, count L, notification body V. Example: 87 unread; badge 99+ above 99, accessible name keeps exact known count.
- **States:** D known positive count; Hov/F bell response/ring; X adjacent reason; Sk stable bell slot; Err unavailable state, no fabricated 0; Ø known zero hides badge; Long 1,287 accessible count; ID localized plural/name; read/unread state has words beyond colour.

### Empty / no-match / unavailable

- **1440:** preserve title/scope/controls; compact state replaces data region. **390:** same state before scrolling, no giant illustration. **Text:** head H, action L, explanation V. Examples: “No invoices yet” / permitted New invoice; “No matching invoices” / Clear filters; “Invoices unavailable” / Retry invoices.
- **States:** D truthful result; Hov/F recovery control; X reason adjacent; Sk same row/table geometry; Err names failed scope + recovery, keeps independent data; Ø separates absence/no-match/failure; Long N48 context wraps; ID +30%; never duplicate toolbar primary or imply unknown is zero.

## Phone composition at 390

- Tile row → two-column compact figure grid; maximum four, only PA-00 figures; long exact amount spans the grid, no horizontal page scroll or one-tile-per-row wall.
- Table row → full identity/context → status/date → key exact amount + Open; extra columns behind one summary-bearing row disclosure. Financial matrices remain contained tables with sticky identity and labelled keyboard-accessible scrolling.
- Fact list → paired label/value columns (≤4 pairs); longer topics → two-column fact grid or sticky-identity table. Grid cells retain paired columns, never label above value down the page; if long money cannot fit, use the table.
- Preserve reading/focus order, full N48 identity, currency and named action; collapse secondary detail, never primary answer or decision prerequisites; ID expands labels by ~30% at unchanged type sizes.

## Figure selection and multi-currency

- One decision fact → number; progress against named target or ranked same-unit comparison → labelled bar; exact reconciliation/multiple measures → table; time trend/distribution → chart only when the comparison answers PA-00. No decorative chart.
- Org-currency figure only when an authorized, dated conversion exists: label “IDR equivalent”; one conversion note gives rate/date/basis and named details; original native amounts remain reachable, never overwritten or silently added.
- Otherwise one figure/row/series per currency in the same form: IDR and USD both numbers, bars or table rows; never a bar for one and prose for another. Never sum currencies or compare raw IDR/USD bar lengths on one money scale.
- Percent comparisons use a common 0–100% scale with currency as row heading; exact native amounts and denominator/sample beside each row. Win rate Count/Value and period changes keep plot/axes/legend/footprint; unavailable is labelled inside that form.
- Whole units by default; preserve supplied fractional precision where financially meaningful (rates, quantities, source statements); show currency, basis and sign. Shared unit/caveat/freshness appears once per group; no prose replacement for multi-currency evidence.

## Conformance checklist — answer per route

1. Primary figure/fact named per persona (PA-00), visible in both first viewports?
2. Exactly five available type roles, ≤3 per block, distinct head/label/value, identical across screens?
3. One container level, grouping by proximity, no nested cards or decorative accent/elevation?
4. Squint test: primary → secondary → major groups identifiable in order at both widths?
5. Unit/currency/basis once per group; provenance/freshness once, detail behind named control?
6. Whole-unit exact amounts, tabular/right-aligned; meaningful fractions preserved; currencies never falsely summed?
7. Phone tile grid, paired facts/sticky-identity table and identity/status/amount/Open rows, never a tall label/value stack?
8. One disclosure per topic, summary in toggle, default collapse named, prerequisites/errors visible?
9. Every molecule's D/Hov/F/X/Sk/Err/Ø/Long/ID states evidenced or passive non-applicability explicit; 44px targets?
I. Proximity and pairing: inside-group gap ≤ half the between-group gap, no orphan section labels, every label within one eye-span of its value, values outrank labels (H-10/H-11/H-12)?
