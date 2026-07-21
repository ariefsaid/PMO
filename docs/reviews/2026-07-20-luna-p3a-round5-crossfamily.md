## NO SHIP — HEAD `39a1c885`

Read-only audit; no files changed. The worktree is already dirty with uncommitted changes, so this verdict is against committed `HEAD` (`a3b4db14`/`39a1c885`), not WIP fixes.

### BLOCKERS

1. **Retries mint new money identities.**  
   `repositories/index.ts:443-484` generates a new PMO ID and idempotency key per call. A lost response after ERP SI/PE creation followed by a user retry creates a second ERP document; PE retries after the 60-second composite window can double-post AR.

2. **Sweep replays rejected/stale commands without authorization.**  
   `0096_erpnext_seam_tables.sql:186-193` selects all `failed` and `pending` rows indefinitely. `erpnext-sweep/index.ts:239-253,735-751` dispatches them directly, bypassing `authGuard`, SoD, process gates, and current role/ownership context. A previously rejected cancel/submit can execute days later. The untracked `0112` appears intended to fix this but is not committed.

3. **Sweep can pull-adopt an outbound ERP document into a second PMO row.**  
   HEAD omits anchors from `sweepFieldsForKind` (`erpnext-sweep/index.ts:97-103`) and has no in-flight outbox-key filter. If ERP POST succeeds before outbox finalization, the sweep adopts it through `applyEngine.ts:121-134`; finalization then maps the same ERP document to the original PMO row.

4. **Sweep recovery still has a Payment Entry cross-kind fallback.**  
   `erpnext-sweep/index.ts:768-786` uses bare anchor probing when `party`/`paid_amount` is absent. A Receive command can adopt a Pay document sharing `reference_no`, then `cancelPayment` can cancel the outgoing payment. The synchronous path has `withPaymentTypeDiscriminator`; the sweep path does not.

5. **SoD remains TOCTOU-raceable.**  
   Submit authorization runs before ERP body construction (`adapter-dispatch/index.ts:519-535`). An approver can update/rewrite the SI, ERP accepts the new amount (`adapter.ts:220-227`), then concurrently submit while `author_user_id` still points to the prior author; the writer stamps the new author only later (`readModelWriters.ts:570-593`).

6. **Native ERP amend leaves the PMO money mirror stale.**  
   `applyFeed.ts:80-88` makes later events for the newly mapped amended document a no-op. `lineage.ts:66-86` and `erpnextFeedDeps.ts:139-144` only repoint/stamp lineage; they do not update status, amount, or outstanding balance. PMO can continue counting the cancelled predecessor.

7. **Project gating is not end-to-end.**  
   The gate excludes submit transitions (`dispatchFactory.ts:209-237`; `adapter-dispatch/index.ts:542-573`), despite FR-SAR-191 requiring project presence on SI submit. Additionally, gate-off amend/update can omit ERP `project` while PMO retains the old `project_id`; sweep recovery also bypasses the index-level missing-project check.

8. **The committed status-oracle fix is incomplete.**  
   `erpnextFeedDeps.ts:336-350` derives SI status whenever `outstanding` is present, even when `docstatus` is absent. A partial webhook with only `outstanding_amount` demotes a submitted/paid invoice to `Draft`, removing it from revenue. Inbound adoption also defaults missing `docstatus` to `0` (`:209-225`). The stricter uncommitted change appears to address this.

9. **Idempotency keys are scoped too narrowly.**  
   The unique key is `(org, domain, pmo_record_id, idempotency_key)` (`0096:47-78`), while all active members can read outbox keys/payloads (`0096:105-109`). Reusing a key from an orphaned `committing` row with a new PMO ID can probe/adopt the old ERP document and attribute its amount to attacker-chosen PMO links. The digest only protects the same tuple.

10. **The claim budget does not bound the actual amend POST.**  
    The 60-second check occurs before the whole `adapter.commit` (`dispatch.ts:304-315`), but amend performs cancel then create (`adapter.ts:169-182`). `erpnextRequest` honors arbitrary `Retry-After` delays (`client.ts:231-243`). A delayed cancel can outlive quarantine; recovery may reissue the amend before the original reaches its non-idempotent POST.

### Round-4 fix status

1. Author restamp: **Partial** — race remains.  
2. Claim budget/probe cap: **Partial** — multi-call amend, unbounded retry delay, and composite probe remain.  
3. Status oracle: **Partial** — HEAD still has the partial-webhook regression.  
4. Rollup paging/allow-list: **Partial** — paging and allow-list exist, but HEAD has no stable ordering (`revenue.ts:173-191`).  
5. Active-member RPC enforcement: **Closed** — `0111` correctly protects both RPCs and preserves the service-role gate path.  
6. Ownership kill-switch: **Partial** — snapshot checks stop later candidates, but webhook/sweep work already past the snapshot can still complete.

**Conclusion: NO SHIP.**
