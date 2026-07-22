/**
 * The PMO-owned adapter contract (ADR-0055 §2, FR-EAS-020/021). PMO domain language ONLY — no PMO code
 * above the contract couples to any external system's shapes (NFR-EAS-CONTRACT-001). Relative imports
 * only (no `@/` alias) so this pure core is Deno-importable by the adapter-dispatch edge function.
 */

/** A PMO domain that an external tier can natively own ('reference' in P0; real domains P1+). */
export type PmoDomain = string;

/** The static per-system capability map: the PMO domains this adapter's tier can natively own (FR-EAS-004). */
export type CapabilityMap = ReadonlySet<PmoDomain>;

/** Write operations an adapter can commit for an owned domain (PMO verbs; never external vocabulary). */
export type AdapterOperation = 'create' | 'update' | 'delete' | 'transition';

/** A PMO-shaped record — the adapter commits THIS shape, never an external system's (FR-EAS-020). */
export interface PmoRecord {
  /** The PMO record id (caller-supplied for create; the canonical id on read). */
  id: string;
  [field: string]: unknown;
}

/** The canonical answer a synchronous command returns: external id + canonical PMO record (FR-EAS-022). */
export interface CommandResult {
  externalRecordId: string;
  canonical: PmoRecord;
}

/** Classified adapter errors (FR-EAS-023). */
export type AdapterErrorCode = 'commit-rejected' | 'external-unreachable';
export class AdapterError extends Error {
  readonly code: AdapterErrorCode;
  constructor(code: AdapterErrorCode, message: string) {
    super(message);
    this.name = 'AdapterError';
    this.code = code;
  }
}

/**
 * ⚑ HIGH-1 (money-safety audit round 5) — the marker an adapter attaches to a thrown error when THIS
 * attempt CANCELLED an external document and then failed to create its replacement.
 *
 * It is not decoration. For a document whose natural grain the external system itself enforces (an ERP
 * `Budget`), a revision must be `cancel(old) → create(new)` — the money fields are locked post-submit —
 * and that pair cannot be made atomic. So the window exists, and in it the CLIENT'S CONTROL IS OFF.
 * Every layer above has to be able to SAY that, rather than reporting a generic push failure: the
 * dispatch keeps the adapter's message instead of its own transient text, and the served fn records it
 * under its own named reason. Lives on the contract because the adapter raises it and the tier-agnostic
 * dispatch consumes it.
 */
export interface SupersededDocumentMarker {
  cancelledExternalRecordId?: string;
}

/**
 * A command issued to an adapter. PMO domain language; NEVER carries org_id (FR-EAS-024) — the dispatch
 * binds the org context ABOVE the adapter. This type is the proof surface for AC-EAS-023.
 */
export interface AdapterCommand {
  domain: PmoDomain;
  operation: AdapterOperation;
  record: PmoRecord;
  /** Client-generated per non-read-only ERPNext money command (FR-ENA-040). P0/P1 ignore it.
   *  REQUIRED for non-read-only `erpnext`-tier commands — enforced server-side in adapter-dispatch
   *  (rejects a missing key as commit-rejected/missing-idempotency-key before the outbox is touched). */
  idempotencyKey?: string;
  /**
   * Luna round-5 BLOCK 10 — the absolute wall-clock instant (ms, `Date.now()` domain) past which this
   * command's claim on the money-outbox critical section expires, and therefore past which a
   * NON-IDEMPOTENT external write (a create POST) must be REFUSED rather than issued.
   *
   * ARMED by `dispatch.ts` at claim time (`claimStartedAt + MONEY_COMMIT_CLAIM_BUDGET_MS`) — never by a
   * client — and it is per-ATTEMPT metadata, not command identity: it is deliberately NOT part of the
   * payload digest and never crosses the FE→edge-fn wire. Absent for every non-money path (P0/P1 and
   * any commit that did not go through a claim) ⇒ unbounded, byte-for-byte prior behavior.
   *
   * WHY it lives on the command rather than in the adapter's construction deps: an ERPNext `commit` is
   * frequently SEVERAL calls (an amend is `cancel` PUT → `create` POST), so a single budget check
   * before `adapter.commit` cannot bound the POST that actually mints money. Threading the deadline
   * with the command lets the ONE chokepoint every non-idempotent create passes through
   * (`erpnext/client.ts`'s `erpnextRequest`) enforce it — a future doctype or verb cannot forget it.
   */
  commitDeadlineAtMs?: number;
}

/** A page of changes since a watermark cursor — the `list-changes-since-watermark` read result (FR-EAS-021). */
export interface ChangesSinceWatermark {
  changes: PmoRecord[];
  /** The cursor to resume from on the next read; `null` when there are no more changes. */
  nextCursor: string | null;
}

/**
 * The read operations the contract requires for each owned domain (FR-EAS-021): `list-changes-since-watermark`
 * (the reconciliation-sweep source; consumed P1) and `get-by-external-id` (resolve/reconcile a ref).
 * PMO domain language only — never external-system vocabulary (NFR-EAS-CONTRACT-001).
 */
export interface AdapterReads {
  listChangesSinceWatermark(domain: PmoDomain, cursor: string | null): Promise<ChangesSinceWatermark>;
  getByExternalId(domain: PmoDomain, externalRecordId: string): Promise<PmoRecord | null>;
}

/** The adapter contract every adapter implements (FR-EAS-020/021): capability map + commands + reads. */
export interface Adapter extends AdapterReads {
  /** The external tier this adapter speaks (e.g. 'reference'). */
  readonly tier: string;
  /** The static per-system capability map (domains this tier can natively own). */
  readonly capabilityMap: CapabilityMap;
  /** Synchronously commit a command; returns external id + canonical record (FR-EAS-022). */
  commit(command: AdapterCommand): Promise<CommandResult>;
}
