# M365 use-leg live probe — first real `graph_proxy` calls (2026-08-18)

**Verdict: the custody chain is CORRECT end to end. The vendor tenant has no SharePoint Online
license — Graph answered `400 BadRequest: "Tenant does not have a SPO license."` on every
SPO-dependent path.** No code defect. The use leg is proven as far as this tenant allows: a real
stored token was decrypted server-side, auto-refreshed (~5h-old connection), sent to Graph, and
Graph processed it — the rejection is about the tenant's licensing, not our request or token.

## Timeline (all times WIB, 2026-08-18)

1. Owner connected live (vendor tenant, three-step ceremony) — `?m365_connected=true`, connection
   row stored under the post-#365 marshalling with the 0151 envelope constraint enforcing.
2. First-ever `graph_proxy` calls (~5h later): `/me/drive`, `/sites?search=*`,
   `/me/drive/root/children` → all `GRAPH_ERROR` (opaque, by design). 502 to client.
3. Diagnosis blocked by observability: nothing recorded Graph's status/code (issue #445 filed).
4. Diagnostic deployed (#446): envelope showed `upstream 400 BadRequest` — NOT 401: token accepted,
   request "malformed or unserviceable". Killed the token-corruption and refresh-bug hypotheses
   (a refresh failure maps to `CONNECTION_STALE`, never `GRAPH_ERROR`; decrypt failure likewise).
5. Bisect probes: every SPO path → same 400; `/me` → our own `SCOPE_INSUFFICIENT` gate (correct —
   `User.Read` is deliberately not consented).
6. Diagnostic extended (#447) to capture Graph's `error.message` →
   **"Tenant does not have a SPO license."** Case closed.

## What this proves (AC-M1 progress)

- Connect leg: re-proven live on the current fn build (v6/v7) — encrypt → store → status.
- **Auto-refresh path: proven live for the first time** — the ~5h-old access token was refreshed
  and rotated, and the refreshed ciphertext round-tripped (a marshalling regression there would
  have surfaced as decrypt/CONNECTION_STALE failures).
- Use leg: token reaches Graph and is accepted. **A data-200 needs a tenant with SharePoint
  Online provisioned** — blocked on licensing, not code.

## What closes AC-M1 (owner action, either)

- Assign a SharePoint-bearing license (e.g. Microsoft 365 Business Basic) to the test user in the
  vendor tenant, wait for SPO provisioning, reconnect NOT required (scopes already granted) —
  re-probe `/me/drive` + `/sites` + `…/versions`; **or**
- park until the first client tenant (which has real SPO) and close AC-M1 there.

## Follow-ups

- #445 fix slice: keep the structured server-side log; restore the opaque client envelope once
  live probing is done. The `SCOPE_INSUFFICIENT` self-gate behaved correctly throughout.
- Product note for doc-linking (M2 spec): a client tenant without SPO licensing will produce
  exactly this failure — the integration UX needs a legible "your Microsoft plan has no
  SharePoint" state, not a generic error. Graduated from a live finding, per the QA portfolio.
