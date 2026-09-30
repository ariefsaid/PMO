# Personal Microsoft 365 Connection Localization

**Issue:** #689
**Status:** Ready for implementation
**Surface:** Personal Integrations card (`M365ConnectionCard`)

## Job story

When a member chooses Bahasa Indonesia in Profile & preferences and opens My integrations, they need the personal Microsoft 365 card's state, actions, and disconnect consequences in Bahasa so they can tell what is connected and what will happen next. English remains the source language and must retain the same meaning.

## Scope

Localize the personal Microsoft 365 card's fixed copy in English and Bahasa Indonesia, including its initial status check, every settled status, action labels, reviewed error copy, and disconnect confirmation. Correct the disconnected and confirmation wording so it describes a personal account connection and access to content available through that account; neither state implies that a connection proves a successful data transfer.

When a disconnect request fails, keep the last confirmed connected state, retain the confirmation dialog, and show an accessible localized explanation with a retry action. This closes the recovery gap identified in #689 and follows `DESIGN.md`'s originating-dialog error rule.

## Deciding artifacts

- `docs/design/2026-09-26-enterprise-coherence-brief.md` separates personal connections from organization integrations and distinguishes a connected account from verified data movement.
- `DESIGN.md`'s Stated-State and No-Raw-Token rules require visible, plain-language states and reviewed copy; its Organization integration readiness and Modal dialog error rules keep failures truthful and actionable in their owning dialog.
- `pmo-portal/src/components/integrations/M365ConnectionCard.tsx` owns the shipped state machine, entitlement gate, callback handling, accessible status/alert roles, and disconnect confirmation.
- `pmo-portal/src/lib/m365/connectClient.ts` owns the reviewed `M365ErrorCode` to English-copy mapping and throws `AppError` values with stable `code` fields.
- `pmo-portal/public/locales/{en,id}/common.json` are the active runtime catalogues. Add the card's static keys under `integrations.personalM365` in both files.

## Requirements

- **FR-M365LOC-001 (ubiquitous):** The card shall render every fixed state, action, and confirmation string in the active `en` or `id` locale. `Microsoft 365`, OneDrive, Teams, Microsoft Graph, and PMO Portal retain their product names.
- **FR-M365LOC-002 (event-driven):** When `connected_at` is present, the card shall insert the already formatted value from `formatDate` into the localized connected sentence; when it is absent, the card shall render the connected sentence without a date. i18next shall receive only the finished date string.
- **FR-M365LOC-003 (event-driven):** When the card receives an error with a known `AppError.code` or callback error code, it shall render that code's reviewed localized message. When a code is absent or unrecognized, it shall render the localized context-appropriate fallback. It shall not render raw error messages, callback values, or error codes. The card shall retain error code and context as state, then derive the displayed text during render so an in-place locale change also updates an existing error.
- **FR-M365LOC-004 (state-driven):** While a status fetch is pending, unavailable, or known, the card shall continue to show the existing loading, unknown, and settled states with their existing status/alert semantics and action availability. A failed or unrecognized status shall not be represented as connected.
- **FR-M365LOC-005 (event-driven):** When disconnect succeeds, the card shall close the confirmation, clear the error, and return to not connected as it does today. When disconnect fails, the card shall retain its last confirmed connected state, keep the confirmation open, show a persistent localized alert inside that dialog, and leave the confirm action available for retry after the request settles.
- **FR-M365LOC-006 (event-driven):** When a user opens the disconnect confirmation, the destructive `alertdialog` shall have a localized accessible name and description, localized Cancel and Disconnect names, and the existing focus, Escape, loading, and confirm-before-write behavior.
- **FR-M365LOC-007 (ubiquitous, #690):** The organization-approval card (`M365OrgApprovalCard`) shall render every string in the active `en` or `id` locale and shall present a failure through the same code-to-copy table as the personal card (`src/lib/m365/errorCopy.ts`), retaining only the stable code and deriving the text at render. It shall not render a server message. A code the edge function can emit that has no entry in that table is a test failure.
- **FR-M365LOC-008 (ubiquitous, #692):** Where copy names an action the visible button also offers, it shall use the button's verb: the insufficient-permission message says "Connect again" (the button reads Connect in that state, not Reconnect). The product is "PMO Portal" wherever it is named, including the disconnect dialog. The `/integrations` intro shall not promise documents or a calendar in projects; it says only that PMO Portal can reach the content the user's own account has access to.
- **FR-M365LOC-009 (ubiquitous, #692):** Where a status or error line wraps, its icon shall align to the first line of text (top-aligned row, icon offset to the first line's centre) at 390px.
- **NFR-M365LOC-001:** The entitlement remains the card's only FE gate. A hidden card shall make no status request; no role gate or connection permission shall change.
- **NFR-M365LOC-002:** Copy shall describe the connection to the user's own Microsoft 365 account and the content that account can access. It shall not say that connecting activates an organization integration or proves data has synced.
- **NFR-M365LOC-003:** Long Bahasa copy and the dialog shall remain readable at 390px in light and dark themes, with meaningful localized accessible names and the existing focus-visible treatment.

## Fixed copy inventory

Use static keys under `integrations.personalM365`; retain the English source text below and add its Bahasa translation. The pending connect action keeps its existing localized Connect/Reconnect name while the shared Button loading indicator is active.

| Key | English source | Bahasa Indonesia |
|---|---|---|
| `state.loading` | Checking Microsoft 365 connection status… | Memeriksa status koneksi Microsoft 365… |
| `state.notConnected` | Not connected. Connect your own Microsoft 365 account to let PMO Portal access the OneDrive files, Teams, and calendar information available through your account. | Belum terhubung. Hubungkan akun Microsoft 365 Anda sendiri agar PMO Portal dapat mengakses file OneDrive, Teams, dan informasi kalender yang tersedia melalui akun Anda. |
| `state.connected` | Connected. You can disconnect any time. | Terhubung. Anda dapat memutuskan koneksi kapan saja. |
| `state.connectedSince` | Connected since {{date}}. You can disconnect any time. | Terhubung sejak {{date}}. Anda dapat memutuskan koneksi kapan saja. |
| `state.organizationApproved` | Your organization has approved the PMO Portal app in Microsoft 365. Connect your own Microsoft 365 account to continue. | Organisasi Anda telah menyetujui aplikasi PMO Portal di Microsoft 365. Hubungkan akun Microsoft 365 Anda sendiri untuk melanjutkan. |
| `state.reconnect` | The Microsoft 365 connection expired. Please reconnect to continue. | Koneksi Microsoft 365 telah kedaluwarsa. Hubungkan ulang untuk melanjutkan. |
| `state.revoked` | The Microsoft 365 connection was revoked. Connect again to continue. | Koneksi Microsoft 365 telah dicabut. Hubungkan kembali untuk melanjutkan. |
| `state.unknown` | We couldn't confirm your Microsoft 365 connection status. Refresh the page to try again. | Kami tidak dapat mengonfirmasi status koneksi Microsoft 365 Anda. Muat ulang halaman untuk mencoba lagi. |
| `action.connect` | Connect Microsoft 365 | Hubungkan Microsoft 365 |
| `action.reconnect` | Reconnect Microsoft 365 | Hubungkan ulang Microsoft 365 |
| `action.disconnect` | Disconnect | Putuskan koneksi |
| `confirm.title` | Disconnect Microsoft 365? | Putuskan koneksi Microsoft 365? |
| `confirm.description` | Disconnecting removes this Microsoft 365 account connection. PMO Portal can no longer access the OneDrive files, Teams, and calendar information available through this account until you reconnect. You can reconnect at any time. | Memutuskan koneksi akan menghapus koneksi akun Microsoft 365 ini. PMO Portal tidak dapat lagi mengakses file OneDrive, Teams, dan informasi kalender yang tersedia melalui akun ini sampai Anda menghubungkannya kembali. Anda dapat menghubungkannya kembali kapan saja. |
| `confirm.cancel` | Cancel | Batal |
| `confirm.confirm` | Disconnect | Putuskan koneksi |
| `errors.disconnectFailureHeadline` | We couldn't confirm the disconnect. The last confirmed status is still connected. | Kami tidak dapat memastikan pemutusan koneksi. Status koneksi terakhir yang terkonfirmasi masih terhubung. |
| `errors.disconnectFailureGuidance` | You can retry or cancel. | Anda dapat mencoba lagi atau membatalkan. |
| `errors.statusFallback` | We couldn't confirm your Microsoft 365 connection status. Refresh the page to try again. | Kami tidak dapat mengonfirmasi status koneksi Microsoft 365 Anda. Muat ulang halaman untuk mencoba lagi. |
| `errors.generic` | Microsoft 365 could not be connected. Please try again. | Microsoft 365 tidak dapat dihubungkan. Silakan coba lagi. |

For known M365 errors, retain the English source owned by `describeM365Error(code)` and add a static key for each code in both catalogues. Map the codes and Bahasa copy as follows; the key suffixes are semantic names, not wire values:

| M365 error code | Key suffix | Bahasa Indonesia |
|---|---|---|
| `NOT_ENTITLED` | `notEntitled` | Organisasi Anda belum mengaktifkan integrasi Microsoft 365. |
| `DISABLED_MEMBER` | `disabledMember` | Akses akun Anda telah dinonaktifkan. Hubungi administrator Anda. |
| `BANNED_MEMBER` | `bannedMember` | Akun Anda ditangguhkan. Hubungi administrator Anda. |
| `ORG_APPROVAL_REQUIRED` | `organizationApprovalRequired` | Organisasi Anda belum menyetujui aplikasi PMO Portal. Minta administrator menyetujuinya di Microsoft 365. |
| `FORBIDDEN` | `forbidden` | Penyetujuan aplikasi PMO Portal di Microsoft 365 hanya dapat dilakukan oleh administrator organisasi dan operator platform. |
| `UNAUTHORIZED` | `unauthorized` | Sesi Anda telah berakhir. Muat ulang halaman lalu coba lagi. |
| `CONNECTION_STALE` | `connectionStale` | Koneksi Microsoft 365 telah kedaluwarsa. Hubungkan ulang. |
| `CONNECTION_REVOKED` | `connectionRevoked` | Koneksi Microsoft 365 telah dicabut. Hubungkan kembali untuk melanjutkan. |
| `NOT_CONNECTED` | `notConnected` | Microsoft 365 belum terhubung. |
| `TOKEN_EXCHANGE_FAILED` | `tokenExchangeFailed` | Microsoft menolak koneksi. Silakan coba lagi. |
| `INVALID_STATE` | `invalidState` | Permintaan koneksi telah kedaluwarsa. Silakan coba lagi. |
| `SCOPE_INSUFFICIENT` | `scopeInsufficient` | Koneksi memerlukan izin tambahan. Hubungkan kembali untuk memberikan izin tersebut. |
| `BAD_REQUEST` | `badRequest` | Permintaan tidak valid. Silakan coba lagi. |
| `GRAPH_ERROR` | `graphError` | Microsoft Graph sedang tidak tersedia. Silakan coba lagi sebentar lagi. |
| `INTERNAL_ERROR` | `internalError` | Terjadi kesalahan di sisi kami. Silakan coba lagi. |

Unknown or missing codes use `errors.generic`; status-fetch errors without a stable code use `errors.statusFallback`. The disconnect dialog shows `errors.disconnectFailureHeadline` as the alert headline so the user sees the recovery outcome even when the service response is ambiguous; when a known code exists, its localized reviewed reason follows, and `errors.disconnectFailureGuidance` states the available action once (headline/body split per the `DESIGN.md` destructive-alert recipe).

## Acceptance criteria

- **AC-M365LOC-001 — English states and actions.** Given an entitled member with English active, when the card is loading or reaches disconnected, organization-approved, connected with or without a date, reconnect, revoked, unknown, connecting, or action-error state, then its fixed copy and accessible Connect/Reconnect/Disconnect names are English; a connected account is not described as proof of synced data. Owner: Vitest in `M365ConnectionCard.test.tsx`.
- **AC-M365LOC-002 — Bahasa states and actions.** Given an entitled member with Bahasa Indonesia active, when the card reaches the same representative states, then fixed copy and accessible action names are in Bahasa, including the longer disconnected and organization-approved messages; the connected date remains formatted by the active locale. Owner: Vitest in `M365ConnectionCard.test.tsx`.
- **AC-M365LOC-003 — Confirmation.** Given either supported locale, when the member opens Disconnect, then an `alertdialog` exposes the localized title, long consequence text, Cancel, and Disconnect through its accessible name/description and button names. Cancel calls no mutation; confirming preserves the existing disconnect request and successful return to disconnected. Owner: Vitest in `M365ConnectionCard.test.tsx`.
- **AC-M365LOC-004 — Reviewed errors.** Given any listed M365 error code, an absent code, or an unrecognized code from callback, status, or connect handling, when the card presents an error, then it shows localized reviewed copy or the appropriate generic fallback, keeps the existing retry/action availability and alert role, clears callback parameters as today, and renders no raw transport string or code. When the active locale changes while an error is visible, that error copy changes language too. Owner: table-driven Vitest cases in `M365ConnectionCard.test.tsx`; catalogue completeness is also covered by `npm run check:i18n`.
- **AC-M365LOC-005 — Disconnect recovery.** Given the card's last confirmed state is connected, when a disconnect attempt fails, then the dialog stays open and contains a localized `role="alert"` with the last-confirmed connected outcome; focus moves to that alert, the confirm action becomes available again for retry, and no raw error text/code is shown. A subsequent successful retry closes the dialog and returns to disconnected. Owner: Vitest in `M365ConnectionCard.test.tsx`.
- **AC-M365LOC-006 — Organization-approval card and the shared error table.** Given either locale, when the organization-approval card renders, then its heading, badge, description and Approve/Opening actions are localized (English defaults hold with no catalogue loaded); when approval fails with a known code it shows that code's reviewed localized message, and with an unknown or absent code the localized `m365OrgApproval.errorFallback`, never the raw message or code; changing language updates a visible error in place. Owners: Vitest in `M365OrgApprovalCard.test.tsx` (behavior) and `src/lib/m365/__tests__/errorCopy.test.ts` (the table covers exactly the 15 codes in the edge function's `ERROR_STATUS`, each with `en` and `id` copy and no raw key or code).
- **AC-M365LOC-007 — Copy agrees with the controls.** Given an insufficient-permission callback, then the message says "Connect again" / "Hubungkan kembali" while the button reads Connect / Hubungkan; the disconnect dialog names "PMO Portal" in both locales; the `/integrations` intro does not mention documents, calendar or projects. Owners: Vitest in `M365ConnectionCard.test.tsx` and `pages/Integrations.test.tsx`.
- **AC-M365LOC-008 — First-line icon alignment.** Given a status or error line that can wrap, then the row is top-aligned and its icon carries the first-line offset. Owners: Vitest in `M365ConnectionCard.test.tsx` and `M365OrgApprovalCard.test.tsx`.

The org-card copy lives under `integrations.m365OrgApproval.*` (`heading`, `badge`, `description`, `approve`, `approving`, `errorFallback`); its known-code messages reuse `integrations.personalM365.errors.*`. The `/administration/:section` launch-scope entry names the card file so the `check:i18n` gate covers it.

## Required rendered Discover check (not an acceptance criterion)

Render `/integrations` at 1440px and 390px in English and Bahasa, in light and dark themes, covering the disconnected, connected, and disconnect-recovery dialog states. Inspect text wrapping, clipping, horizontal overflow, localized accessible names, and dialog focus. Record confirmed defects in the `docs/qa-portfolio.md` graduation registry with their owning test, matrix cell, and concise `DESIGN.md` note; do not create a registry entry for an unconfirmed preference. AC-M365LOC-005 remains the automated owner for disconnect-recovery behavior.

## Scope fences

- Do not change the connection state machine, callback URL contract/cleanup, fetch timing, entitlement gate, server authorization, token custody, or role model. The organization approval surface's behavior is unchanged too; only its copy and error presentation are localized (FR-M365LOC-007, #690).
- Do not claim that an account connection means an organization integration is active or data movement has succeeded.
- Do not introduce another locale store, translation package, server schema, or a new shared confirmation-dialog component. #692 does change the shared `ConfirmDialog` for every consumer (its background is inert while open, matching `EntityFormModal`); no other dialog behavior changes.
- No live Microsoft account is required for this card-copy acceptance; the separate live data-transfer acceptance remains under the enterprise coherence brief.
