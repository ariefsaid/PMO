# Personal locale completion — spec (#684)

**Status:** proposed for the enterprise UX program, 2026-09-27. **Authority:** owner-settled issue #468 and `docs/decisions.md` DD-I18N-1/2/4; `docs/design/2026-09-26-enterprise-coherence-brief.md`. The existing profile columns, locale resolver, formatter seam, and Profile & preferences route are the starting point.

## Job story and observed gap

When I work in an organization whose default language, number convention, or timezone differs from mine, I want to set my own display preferences in one recognizable account place, so dates, times, and money make sense to me across sessions and devices. Profile & preferences currently exposes only the interface language. The resolved number locale and timezone exist in the profile/runtime, but a user cannot select them there. The current time-bearing formatter follows the browser's local zone rather than the resolved profile timezone, so a timezone control alone would not deliver its promised result.

## Interaction and data contract

1. **One account form.** Profile & preferences groups Interface language, Number format, and Timezone under one heading. Each control includes “Organization default” and displays the current effective inherited value. An explicit choice remains explicit even when it matches today's org default. Saving writes all three personal preference columns, where `NULL` means inherit, then refreshes the signed-in profile before claiming success. A failed write or refresh preserves the user's unsaved choices and offers retry.
2. **Useful previews.** Number choices show a neutral example (`1.234.567,89` versus `1,234,567.89`) so a user can identify the convention before saving. Supported explicit values for this two-language release are `id-ID` and `en-US`; the inherited value remains distinct from either. Timezone choices use valid IANA zone names and are searchable; the current org/default zone and current override remain selectable. The control names the effective zone, not only the stored override.
3. **Immediate, coherent display.** After a successful profile refresh, labels follow the chosen language and on-screen numbers/money follow the resolved number locale. Time-bearing instants, such as meeting occurrence, use the resolved timezone. An instant shown only as a date, such as a connection or snapshot date, uses the same zone to determine its calendar day. Date-only values (contract dates, due dates, timesheet days) remain the same calendar day regardless of timezone. Relative elapsed time remains elapsed time. CSV, XLSX, API values, and logs keep their existing neutral/typed conventions.
4. **Money entry follows the same convention.** Every on-screen money input affected by the preference groups digits as the user types in the resolved number convention. Validation and persistence use the same locale-aware parse, including the mixed-case oracle `1.234` → 1234 under `id-ID` and → 1.234 under `en-US`. The neutral spreadsheet/CSV import parser remains independent of the viewer's display preference, and typed export cells remain numeric. The existing fixed-convention input paths must be upgraded in the same code change as the preference control, per DD-I18N-3; a display-only change is not sufficient.
5. **Current authority.** Profile preferences remain self-service for the signed-in user under the existing data access model. The screen does not expose organization-default editing or another user's preferences. The interface must work in English and Bahasa Indonesia, light/dark, keyboard, and a 390px phone without a long unsearchable timezone menu.

## Requirements (EARS)

- **FR-PLC-001:** When a signed-in user opens Profile & preferences, the application shall show their stored language, number-format, and timezone choices separately from the current effective inherited values.
- **FR-PLC-002:** When a user chooses Organization default for any preference, the application shall store `NULL` for that preference and keep explicit choices for the other two.
- **FR-PLC-003:** When a user saves valid preferences, the application shall refresh their profile and apply the resulting language, number, and timezone display in the same session before showing success.
- **FR-PLC-004:** When a write or refresh fails, the application shall retain the pending choices, show an accessible error, and allow a retry without silently claiming success.
- **FR-PLC-005:** When a user changes number format, the application shall display on-screen numeric and monetary values with the chosen grouping and decimal convention while preserving the record's currency and numeric value.
- **FR-PLC-006:** When a user changes timezone, the application shall display time-bearing instants and instant-derived calendar dates in that zone while keeping date-only fields invariant.
- **FR-PLC-007:** While the timezone selector is used, the application shall offer searchable valid IANA choices and reject an invalid value before persistence.
- **FR-PLC-008:** While the user works in either language, light or dark theme, or a 390px viewport, the controls, examples, state messages, and save action shall remain readable and keyboard/touch usable.
- **FR-PLC-009:** While data is exported or sent to an API, the application shall keep typed numbers and dates, ISO/machine values, and the existing neutral CSV convention independent of personal display preferences.
- **FR-PLC-010:** When a user enters a money amount on screen, the application shall group it in their resolved number convention and shall validate and persist the same numeric interpretation; neutral imports shall continue to use a viewer-independent parse.

## Acceptance criteria and owning proof

| ID | Given / When / Then | Owning layer |
|---|---|---|
| **AC-PLC-001** | Given a profile inheriting all three organization defaults, when Profile & preferences opens, then each control says Organization default, names its effective value, and shows a usable number example and timezone choice. | Component |
| **AC-PLC-002** | Given three explicit choices, when the user resets only Number format to Organization default and saves, then the stored number override is `NULL`, language/timezone stay explicit, and refresh precedes success. | Component + repository contract |
| **AC-PLC-003** | Given a write failure or profile-refresh failure, when Save is activated, then the chosen values remain, an accessible error appears, and retry can complete without duplicate success. | Component |
| **AC-PLC-004** | Given the same numeric value and currency, when the effective number locale changes between `id-ID` and `en-US`, then on-screen money and plain numbers use the corresponding separators without changing magnitude or currency. | Formatter/unit and rendered integration |
| **AC-PLC-005** | Given one instant near a calendar-day boundary, when the effective timezone changes, then its displayed meeting time and instant-derived date change correctly; a date-only due/contract value remains on its original day. | Formatter/unit |
| **AC-PLC-006** | Given an invalid timezone identifier, when the user attempts to save, then the invalid value is rejected and no preference write occurs. | Component/unit |
| **AC-PLC-007** | Given a signed-in user on a 390px screen in English or Bahasa Indonesia, when they choose and save all three preferences, then controls remain reachable, feedback is understandable, and the updated display is visible without a reload. | Curated browser journey |
| **AC-PLC-008** | Given an on-screen locale switch, when an XLSX/CSV export is produced, then typed/neutral export values remain independent of the display convention. | Export/unit regression |
| **AC-PLC-009** | Given `1.234` in an on-screen money field, when the resolved number locale is `id-ID` versus `en-US`, then the mask, validation, and persisted numeric value agree at 1234 versus 1.234 respectively; neutral import of the same machine-format cell stays viewer-independent. | Money input/import unit and component |

## Boundaries and review

Do not add a date-format preference, change the organization default, infer a currency from the user's locale, or pass formatted strings into exports. Keep `resolveLocale` as the only preference-resolution seam. Split date-only formatting from instant formatting explicitly; do not apply a timezone to local-midnight date-only values. Preserve one parse for each money form's validation and persistence; a neutral import may use a separate, explicitly named machine parser. This change touches money entry/display and preference writes, so implementation and review must include the project's money/auth tier, a mutation check for locale-sensitive money parsing, and the full pre-push verification gate.
