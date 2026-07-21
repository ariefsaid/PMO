/**
 * PMO-target binding guards for erpnext-tier commands (Luna re-audit BLOCK #2 + BLOCK #4).
 *
 * The adapter acts on a CALLER-SUPPLIED `record.externalRecordId` (`erpnext/adapter.ts`
 * commitTransition / commitUpdateSubmittable), while every authorization/SoD check upstream is keyed
 * on the PMO `record.id`. Unless the two are bound to each other, an authorized caller can pair their
 * own PMO id with SOMEONE ELSE'S ERP document name and submit/cancel/amend it.
 *
 * BLOCK #2 — bind EVERY erpnext transition/update (all kinds, all domains) to the PMO record's OWN
 * recorded `external_refs` mapping, and FAIL CLOSED when no mapping exists. The previous revision
 * guarded only revenue sales-invoice transitions and explicitly permitted a missing mapping, so
 * `incoming-payment` and the whole `procurement` domain were unprotected (e.g. cancel a Pay Payment
 * Entry through the Receive kind), and an unmapped PMO id passed straight through.
 *
 * BLOCK #4 — a `create` must not target an ALREADY-MAPPED PMO record. `record_outbox_ref`
 * (0096) upserts `external_refs` BEFORE the read-model mirror insert, so a caller reusing an existing
 * `sales_invoices.id` repoints that invoice's external identity to a brand-new ERP document and only
 * THEN fails on the duplicate PK — the ERP money is already minted and the old mapping is gone. The
 * one legitimate case of "mapping already present on a create" is this same command's own retry
 * (crash after `record_outbox_ref`, before/at the mirror), which is identified by its outbox row
 * carrying the SAME idempotency key.
 *
 * Both guards run in `index.ts` BEFORE adapter select / outbox insert / any ERP write.
 */
import { resolveExternalRef, type ExternalRefsLookupClient } from '../../../pmo-portal/src/lib/adapterSeam/refs.ts';
import { DOCTYPE_REGISTRY, type ErpDocKind } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/doctypeRegistry.ts';

/** The structural service-role read seam both guards need: `.from(t).select(c).eq(...)…maybeSingle()`.
 *  Identical to `refs.ts`'s `ExternalRefsLookupClient` (the filter builder is chainable), re-exported
 *  under a guard-local name so callers/tests have one import site. */
export type GuardLookupClient = ExternalRefsLookupClient;

export interface TransitionBindingResult {
  ok: boolean;
  status: number;
  message: string;
}

const OK: TransitionBindingResult = { ok: true, status: 200, message: '' };

/** The PMO domains the erpnext tier owns. A P0/P1 domain (`reference`/`tasks`) is never guarded here —
 *  it has no ERP document identity to bind. */
const ERP_DOMAINS = new Set(['companies', 'procurement', 'revenue', 'timesheets']);

/**
 * P3b FR-TSP-013 — the domains that accept NO caller-supplied ERP target AT ALL.
 *
 * The other domains compare a supplied `externalRecordId` against the PMO record's own
 * `external_refs` mapping. A Posture-B push (ADR-0059) never needs one: its ERP target is resolved
 * solely server-side from `external_refs(org, domain, record.id)`. Rejecting the mere PRESENCE of a
 * client-supplied target therefore removes the "authorized PMO id paired with a foreign ERP document"
 * class BY CONSTRUCTION rather than by comparison — a strictly stronger rule, applied to the new
 * domain only, so every shipped domain stays byte-for-byte.
 */
const REJECT_CLIENT_SUPPLIED_TARGET = new Set(['timesheets']);

/** `{ok:false}` when this domain forbids a caller-supplied ERP target and the command carries one. */
function checkNoClientSuppliedTarget(command: GuardCommand): TransitionBindingResult | null {
  if (!REJECT_CLIENT_SUPPLIED_TARGET.has(command.domain)) return null;
  const supplied = command.record.externalRecordId;
  if (typeof supplied === 'string' && supplied.length > 0) {
    return {
      ok: false,
      status: 422,
      message: 'externalRecordId is not accepted for this domain — the external target is resolved server-side',
    };
  }
  return null;
}

interface GuardCommand {
  domain: string;
  operation: string;
  record: { id: string; erp_doc_kind?: unknown; externalRecordId?: unknown; [key: string]: unknown };
}

/** The `external_refs` storage encoding for a companies-domain party is `"<Doctype>:<name>"` (task
 *  3.2's collision rule) while the wire/adapter value is the BARE ERP name — so a stored mapping
 *  matches either verbatim or with this command's own doctype prefix. Never a bare `indexOf(':')`
 *  strip: that would let a `Supplier:X` mapping validate a `Customer:X` target. */
function mappingMatches(mapped: string, suppliedExternalRecordId: string, record: GuardCommand['record']): boolean {
  if (mapped === suppliedExternalRecordId) return true;
  const kind = record.erp_doc_kind;
  const entry = typeof kind === 'string' && kind in DOCTYPE_REGISTRY ? DOCTYPE_REGISTRY[kind as ErpDocKind] : undefined;
  return entry ? mapped === `${entry.doctype}:${suppliedExternalRecordId}` : false;
}

/**
 * BLOCK #2 — bind a transition/update to the PMO record's own `external_refs` mapping.
 *
 * Applies to EVERY erpnext domain and EVERY `erp_doc_kind`. Returns `{ok:false, status:422}` when
 * the PMO record has no recorded mapping (fail closed — there is no legitimate transition of a record
 * that was never externalized) or when the caller's `externalRecordId` names a DIFFERENT document
 * than the one this PMO record is mapped to.
 *
 * A command carrying NO `externalRecordId` on a mapped record is allowed through: there is no
 * caller-supplied target to mis-bind (the companies update path resolves its target server-side from
 * the same mapping; the submittable paths are rejected by the adapter's own explicit check).
 */
export async function checkTransitionTargetBinding(
  client: GuardLookupClient,
  orgId: string,
  command: GuardCommand,
): Promise<TransitionBindingResult> {
  if (!ERP_DOMAINS.has(command.domain)) return OK;
  const noClientTarget = checkNoClientSuppliedTarget(command);
  if (noClientTarget) return noClientTarget;
  const operation = String(command.operation);
  if (operation !== 'transition' && operation !== 'update') return OK;

  const mapped = await resolveExternalRef(client, orgId, command.domain, String(command.record.id));
  if (mapped === null) {
    return {
      ok: false,
      status: 422,
      message: 'no external mapping recorded for this PMO record — refusing to act on a caller-supplied external id',
    };
  }

  const externalRecordId = command.record.externalRecordId;
  if (typeof externalRecordId !== 'string' || externalRecordId.length === 0) return OK;

  if (!mappingMatches(mapped, externalRecordId, command.record)) {
    return { ok: false, status: 422, message: 'externalRecordId does not match PMO record mapping' };
  }
  return OK;
}

/**
 * BLOCK #4 — a `create` may not target an already-mapped PMO record.
 *
 * Rejects 422 BEFORE the adapter/outbox/ERP write when `(org, domain, record.id)` already resolves to
 * an external document, UNLESS an outbox row for this exact command (same idempotency key) already
 * exists — that is this command's own retry finalizing after a crash, which MUST be allowed through.
 */
export async function checkCreateTargetUnmapped(
  client: GuardLookupClient,
  orgId: string,
  command: GuardCommand,
  idempotencyKey: string | undefined,
): Promise<TransitionBindingResult> {
  if (!ERP_DOMAINS.has(command.domain)) return OK;
  if (String(command.operation) !== 'create') return OK;
  const noClientTarget = checkNoClientSuppliedTarget(command);
  if (noClientTarget) return noClientTarget;

  const pmoRecordId = String(command.record.id);
  const mapped = await resolveExternalRef(client, orgId, command.domain, pmoRecordId);
  if (mapped === null) return OK;

  if (idempotencyKey && (await outboxRowExists(client, orgId, command.domain, pmoRecordId, idempotencyKey))) {
    return OK;
  }
  return {
    ok: false,
    status: 422,
    message: 'record.id is already mapped to an external document — a create must target a new PMO record',
  };
}

/** Canonical RFC-4122 8-4-4-4-12 hex layout, anchored and case-insensitive — the shape
 *  `crypto.randomUUID()` produces (`repositories/index.ts` freshIdempotencyKey). Deliberately NOT
 *  version/variant-pinned: any opaque 122-bit-ish UUID is fine, the property we need is unguessable
 *  fixed-width opacity, not a particular UUID version. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * P3b FR-TSP-041 (ADR-0059 §4) — the DETERMINISTIC Posture-B key: `'<prefix>:<uuid>:<state stamp>'`.
 *
 * A Posture-B push has TWO independent originators (the user's transition and the reconciling sweep)
 * with NO shared client state, so a freshly-minted random key would make the outbox's
 * `unique (org_id, domain, pmo_record_id, idempotency_key)` useless for exactly the collision it
 * exists to prevent — two external documents for one intent (a DUPLICATED WEEK of hours). The key
 * must therefore be DERIVED, which the canonical-UUID shape below cannot express.
 *
 * This shape keeps all three properties the UUID rule exists for:
 *  • it embeds a full canonical UUID, so it can never be a proper substring of another document's
 *    anchor (the `%key%` recovery probe stays unambiguous);
 *  • it is anchored and fixed-alphabet — no `%` or `_` LIKE metacharacter can appear;
 *  • the state stamp is REQUIRED, so a key can never degrade to a short/guessable token.
 */
const DETERMINISTIC_KEY_RE = /^[a-z]{1,8}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9TZ:.+-]{4,40}$/i;

/**
 * BLOCK #1 (Lane C hand-off) — the idempotency key must be an OPAQUE UUID.
 *
 * The ERPNext recovery probe matches the doctype's anchor field with `%key%` — a SUBSTRING match,
 * kept deliberately: a false-negative probe triggers a REISSUE (duplicate money), which is worse than
 * the LIKE-metacharacter injection Lane C closed by escaping the pattern in `client.ts`. That leaves
 * a second vector at THIS boundary: a direct caller supplying a SHORT key (say `"1"`) matches every
 * ERP document whose anchor merely CONTAINS that substring, and recovery then adopts the wrong
 * document — the same "recovery can adopt the wrong ERP document" money path.
 *
 * Requiring a UUID-shaped key makes the entire substring class unreachable BY CONSTRUCTION: a
 * canonical UUID cannot be a proper substring of another document's UUID anchor, and it cannot carry
 * a LIKE metacharacter. This is a shape check, never a length threshold — `'a'.repeat(64)` is
 * rejected exactly like `'1'`.
 */
export function isOpaqueIdempotencyKey(key: string | undefined | null): boolean {
  return typeof key === 'string' && (UUID_RE.test(key) || DETERMINISTIC_KEY_RE.test(key));
}

/** Does THIS command (org+domain+record+idempotency key — the outbox's own unique 4-tuple, 0096)
 *  already have an outbox row? `true` ⇒ the create in flight is a retry of the row that wrote the
 *  mapping, not a caller reusing another record's id. */
async function outboxRowExists(
  client: GuardLookupClient,
  orgId: string,
  domain: string,
  pmoRecordId: string,
  idempotencyKey: string,
): Promise<boolean> {
  const { data } = await client
    .from('external_command_outbox')
    .select('id')
    .eq('org_id', orgId)
    .eq('domain', domain)
    .eq('pmo_record_id', pmoRecordId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  return data !== null && data !== undefined;
}
