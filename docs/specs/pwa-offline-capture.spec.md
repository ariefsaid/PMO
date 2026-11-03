# Spec: app-wide offline capture and targeted notifications (#1520)

**Status:** proposed; owner sign-off required. Route #1481, ruling #1501 supersedes OD-CR-12 and rebuilds #718. IDs `FR-PWA-###`, `NFR-PWA-###`, `AC-PWA-###`. Director-dispatched: auth, identity, notification and stock/SoD slices ship alone. This is one PMO app, not another field product.

## Job story and scope

When connectivity disappears at a site, a field worker needs to retain a new record and see whether it eventually passed the same checks as a live entry, so work is neither lost nor mistaken for approved work. A person who must act needs a single chosen notification channel for that event. The app can be installed; clock-in/out, daily reports, material issues, equipment usage and photos may be captured offline. Approvals, money and edits of shared records require a live server. Existing domain records and workflows remain authoritative; no offline approval, stock balance or ERP posting is invented here.

Rulings: #1491 defines report content and project/BoQ attribution; #1487 requires project and BoQ on a stock issue and ERP authority when connected; #1496 requires site-checked attendance; #1498 requires per-asset/project usage; #1488 attributes people, material and equipment from operational records; #1485 keeps PMO the interface. #1517, #1522 and #1519 own their respective domain rules; #1512 and #1508 own stock and connected posting; #1515 owns low-cash thresholds and recipients; #902 owns the future role matrix; #1521 owns Lark identity/cards. This foundation can ship without those modules; adapters and event producers ship only when their domain contract exists. Do not represent a stub as a completed field journey.

## Requirements (EARS)

- FR-PWA-001 The system shall provide one installable app shell and a clearly marked offline state; it shall not cache authenticated API responses or shared records as an authoritative offline snapshot.
- FR-PWA-002 While offline, the system shall allow a signed-in user on their device to create only clock events, daily reports, material issues, equipment usage and photos through registered domain capture forms; each form shall preserve its required evidence and project/BoQ relationships as defined by its owning domain.
- FR-PWA-003 When capture is saved locally, the system shall persist a stable random operation ID, schema version, actor and org binding, capture time, payload and photo blobs atomically before showing queued; storage failure shall leave the form open and report failure.
- FR-PWA-004 While offline, the system shall prohibit approval, money operations and edits to shared records; local edits of an unsynced draft are permitted, but are never presented as a server edit.
- FR-PWA-005 When connectivity and an authenticated session for the same active actor and org return, the system shall submit each eligible operation using its stable ID to its existing domain write authority, applying the same authorization, validation, SoD and current-state checks as live entry.
- FR-PWA-006 When the server commits an operation, the system shall atomically record its actor/org/type/key and resulting domain record with the domain write; a retry with identical key and payload returns that result, and a changed payload under the same key is refused. Concurrent attempts shall create at most one domain record.
- FR-PWA-007 When sync is rejected for a correctable domain or permission reason, the system shall keep the record and photos on that device in Needs fixing, with a safe actionable reason; it shall never overwrite a shared record or silently discard a submission.
- FR-PWA-008 When a user corrects a failed unsynced draft, the system shall retain its old key until its server outcome is known; after a definite rejection it shall assign a fresh key to the revised payload. An ambiguous outcome shall be reconciled with the original key before any correction is submitted.
- FR-PWA-009 When transport, session or service availability prevents a definitive outcome, the system shall keep the item queued, show the reason and retry with bounded backoff on foreground resume or connectivity restoration. It shall not assume a browser background-sync event will run.
- FR-PWA-010 When a photo upload succeeds but its owning record has not committed, the system shall retain the association and retry idempotently; only after the complete authoritative record and attachments are confirmed may local payload and blobs be removed. Orphan cleanup shall not delete a referenced photo.
- FR-PWA-011 When account or org changes, the system shall isolate pending drafts by original actor and org, never submit or display them to another account, and explain that the original account is required. Sign-out shall warn about pending data and offer cancellation or explicit local discard; no silent deletion.
- FR-PWA-012 When storage quota, eviction, unsupported install/push, expired authentication or incompatible queued schema prevents work, the system shall show an actionable state; it shall never claim the record was saved to the server. Persistent storage is requested where available, but cannot guarantee survival of browser storage clearing.
- FR-PWA-013 When an approval awaits action, a record is rejected, a sync definitively fails, or site cash becomes low, the system shall address the responsible active user(s) selected by the owning workflow, not a broadcast population; current authorization shall be checked before dispatch and when opening the record.
- FR-PWA-014 The system shall let each user choose exactly one of phone push, Lark or email per event category; the selected channel is snapshotted for each event and no automatic fallback sends to another channel. An unavailable choice shall be shown as unavailable with recovery instructions.
- FR-PWA-015 When an eligible event occurs, the system shall create one durable delivery intent per event and recipient, reuse the existing notification inbox and workflow recipient authority, and deduplicate repeat producer calls. The delivery worker shall use provider idempotency where available; ambiguous provider outcomes shall be marked unknown rather than blindly resent. No system can guarantee exactly-once display by an external provider.
- FR-PWA-016 When a sync failure occurs only on a disconnected device, the device shall show Needs fixing immediately; a remote notification is created only after it can report the failure to the server, and shall not expose the draft payload.
- FR-PWA-017 When a user opens a notification, the app shall navigate to the authorized existing record or Needs fixing; a stale or unauthorized link shall show an unavailable state. Push content shall contain no sensitive record details.
- FR-PWA-018 The system shall maintain device registration, revocation and channel preferences scoped to the active user and org; sign-out or revoked membership prevents subsequent dispatch, and a stale push subscription is disabled without switching channels.

## Non-functional requirements

- NFR-PWA-001 Business tables carry `org_id`, RLS and server-stamped identity. Client policy (`can()`/`CanWrite`) is UX, not authorization; repositories wrap existing DAL and domain commands. No tokens in service-worker cache or push payload.
- NFR-PWA-002 Use HTTPS and a versioned shell cache; never cache authenticated responses. A failed shell upgrade preserves queued schema and exposes recovery rather than deleting data.
- NFR-PWA-003 Queued data stays on the originating device; it may be evicted or removed by the OS/user. Record GPS consent, retention and evidence under #1517, not an invented universal policy. Photo size limits follow the owning domain and storage quotas.
- NFR-PWA-004 English and Indonesian strings, keyboard access, labelled states and WCAG AA; test airplane-mode recovery and explicit server outcomes. Queue listing is paged or bounded, retry concurrency is bounded, and large blobs are streamed where supported.
- NFR-PWA-005 Successful local enqueue appears within two seconds for a 1 MB photo on a supported test device; sync is resumable after restart. Delivery is best effort with visible failed/unknown states, not a promise of external-provider exactly-once receipt.

## Acceptance criteria

- AC-PWA-001 Given a supported browser, when the user installs and goes offline, then the app shell opens and indicates offline status. (browser)
- AC-PWA-002 Given each registered field type and a photo, when saved offline, then the same actor can reopen its durable queued payload after reload. (browser)
- AC-PWA-003 Given offline mode, when a user attempts approval, a money operation or a shared-record edit, then no server mutation is queued or reported complete. (unit)
- AC-PWA-004 Given a queued valid field record, when the same actor reconnects, then the authoritative domain write is committed and the item is removed only after confirmation. (browser)
- AC-PWA-005 Given changed server state or revoked authority, when a queued record is submitted, then the domain rejects it and the device shows a specific actionable Needs fixing reason with its data retained. (pgTAP for server rejection; browser journey AC-PWA-015 for device presentation)
- AC-PWA-006 Given duplicate concurrent submissions or a lost response, when the same key and payload are retried, then one domain record exists and the same result is returned; a different payload is refused. (pgTAP)
- AC-PWA-007 Given an ambiguous sync outcome, when the user attempts correction, then the original key is reconciled before a revised submission can be sent. (unit)
- AC-PWA-008 Given a photo or record upload interruption, when sync resumes, then the photo remains linked to one record and local data remains until both are confirmed. (integration)
- AC-PWA-009 Given another user or org signs in on the device, when the queue is opened or sync runs, then the original user's drafts are neither displayed nor submitted. (unit)
- AC-PWA-010 Given local storage fails, when capture is saved, then the user sees failure and the unsaved form remains available. (unit)
- AC-PWA-011 Given an event with a chosen channel, when the producer repeats it or workers race, then exactly one recipient intent exists with that channel, and no alternate channel is dispatched. (pgTAP)
- AC-PWA-012 Given provider response is ambiguous, when the worker resumes, then it marks the delivery unknown without an unsafe duplicate send. (Deno)
- AC-PWA-013 Given inactive or unauthorized recipients, when dispatch runs, then no message is sent to them. (Deno)
- AC-PWA-014 Given unavailable push or a stale notification link, when the user acts, then an understandable recovery or unavailable state appears without disclosing the record. (unit)
- AC-PWA-015 Given a rejected queued field record, when the user reconnects, then Needs fixing retains its data and reason and a corrected record can be submitted. (browser)
- AC-PWA-016 Given a user has pending drafts, when they sign out, then they can cancel sign-out or explicitly discard local drafts. (unit)

## Errors and recovery

| Condition | Result |
|---|---|
| Network timeout or session expiry | Keep pending; reauthenticate as original actor and retry same key. |
| Domain validation or authorization refusal | Needs fixing; retain evidence; show safe reason, no automatic overwrite. |
| Storage full/evicted | Do not claim persistence; offer space/recovery; eviction cannot restore unreplicated data. |
| Provider unavailable or unknown response | Keep delivery status visible; no cross-channel fallback; reconcile before any retry. |
| Record or recipient no longer authorized | Refuse sync/dispatch or opening; retain local draft for its owner. |

## Owner decisions, recommended defaults and failure if wrong

These are proposals, not rulings; sign-off is required before affected build slices.

| Decision | Recommended default | Named failure if wrong |
|---|---|---|
| OD-PWA-1 local retention | Keep pending drafts until confirmed or explicitly discarded; warn on sign-out. | Automatic cleanup could delete a week of unsubmitted field work. |
| OD-PWA-2 shared devices | Bind drafts to actor/org and require original sign-in; do not promise encryption against a device owner. | A coworker could see or submit someone else's sensitive field evidence. |
| OD-PWA-3 channel default | Email when configured; otherwise show setup required, with no automatic fallback. | A person could miss an urgent action or receive multiple channels. |
| OD-PWA-4 ambiguous provider result | Hold unknown for reconciliation; do not automatically resend without provider deduplication. | Blind retry can deliver duplicates; holding can delay an alert. |
| OD-PWA-5 photo handling | Commit domain record and attachment association as one logical operation with staged upload and cleanup. | A confirmed report could lose its photo or create duplicate orphan files. |
| OD-PWA-6 recipient selection | Existing domain workflow determines actual responsible users; low-cash recipient/threshold comes from #1515. | Broadcasting eligible roles can alert people who cannot or need not act. |
| OD-PWA-8 offline reads | Start with the shell and locally captured drafts; do not cache previously viewed shared records until a user-scoped read-cache design is approved. | A worker offline cannot consult an earlier shared record that was available in the superseded #718 proposal. |
| OD-PWA-9 push endpoints | Keep one active phone endpoint per user and org; replacing it requires an explicit user action. | A user relying on two phones may miss a notification on the older phone. |
| OD-PWA-7 device loss | Explain browser storage loss and offer export only after a separately designed secure export. | A lost or cleared device can permanently lose unsynced evidence. |

## Implementation checklist

- [ ] Approve owner defaults and domain contracts; establish shell and private queue.
- [ ] Add atomic idempotency at each existing domain authority, with server tests.
- [ ] Connect each available domain adapter and photo lifecycle, Needs fixing and recovery.
- [ ] Add recipient/channel identity, delivery intent and provider adapters; integrate owning events.
- [ ] Verify AC ownership, security, accessibility and offline browser journey before release.
