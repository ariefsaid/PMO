/** Cross-org + ERP-project PRE-FLIGHT gates for the ERPNext dispatch (T-31 / ADP-021 / XG04-004,
 *  Luna re-audit BLOCK 2 / BLOCK 4). Extracted verbatim from `dispatchFactory.ts`, which calls them
 *  in the SAME order as before: the link pre-flight runs FIRST — before ref resolution (which can
 *  issue ERP GETs), before the adapter is constructed, and therefore before any ERP write or outbox
 *  commit; the SI project gate likewise runs ahead of any ERP write. */
import { AppError } from '../../appError.ts';
import { readProcessGates } from './processGates.ts';
import type { DispatchServiceClient, ErpDispatchFactoryDeps, ExternalOrgBindingRow } from './dispatchTypes.ts';
import { buildsSalesInvoiceBody } from './dispatchTypes.ts';
import { resolveErpProjectName } from './dispatchRefs.ts';

/** Every cross-entity PMO link a command can carry, and the table each must belong to in the caller's
 *  org. `readModelWriters` guards the SAME links, but only inside the MIRROR writers — which run AFTER
 *  `adapter.commit()` and `recordOutboxRef`. By then a cross-org link has already minted a REAL ERP
 *  money document that no PMO row can ever reference (orphan money), or — round-7 B10 — a mirror row
 *  stamped with the CALLER's org_id but ANOTHER tenant's foreign key (a service-role write; RLS does
 *  not protect it). This table drives the PRE-flight; the post-commit guards stay as defence in depth.
 *
 *  Round-7 B10 added the `procurement` half: only the three revenue links were pre-flighted, so a
 *  direct command carrying another tenant's known `procurementId` was accepted. */
type LinkField = 'customerId' | 'projectId' | 'salesInvoiceId' | 'workOrderId' | 'procurementId' | 'vendorId' | 'invoiceId';

const LINK_TABLE: Readonly<Record<LinkField, string>> = {
  customerId: 'companies',
  projectId: 'projects',
  salesInvoiceId: 'sales_invoices',
  workOrderId: 'work_orders',
  procurementId: 'procurements',
  vendorId: 'companies',
  invoiceId: 'procurement_invoices',
};

/** The links each ERPNext domain's commands can carry (the fields `readModelWriters` copies into the
 *  service-role mirror insert). `companies` (supplier/customer parties) carries none. */
const DOMAIN_LINK_FIELDS: Readonly<Record<string, ReadonlyArray<LinkField>>> = {
  revenue: ['customerId', 'projectId', 'salesInvoiceId', 'workOrderId'],
  procurement: ['procurementId', 'vendorId', 'invoiceId'],
  // P3c: a budget push is scoped to ONE project. A cross-org `projectId` would push this org's figures
  // onto another tenant's ERP project dimension — refused here, before the adapter exists.
  budget: ['projectId'],
};

/** Assert one linked row exists AND belongs to `orgId`. Fails CLOSED: a missing row (no row, or an id
 *  from another tenant that RLS-free service-role reads would happily return) is rejected exactly like
 *  a cross-org one — never treated as an absent link. Throws the classified `cross-org-link-rejected`
 *  (the same code `readModelWriters` raises, so the caller-facing classification is unchanged). */
export async function assertLinkBelongsToOrg(
  serviceClient: DispatchServiceClient,
  orgId: string,
  table: string,
  id: string,
): Promise<void> {
  const { data, error } = await serviceClient.from(table).select('org_id').eq('id', id).maybeSingle();
  if (error) throw new AppError(error.message, error.code);
  const rowOrgId = (data as { org_id: string } | null)?.org_id;
  if (rowOrgId !== orgId) {
    throw new AppError(
      `cross-org link rejected: ${table} '${id}' does not belong to org '${orgId}'`,
      'cross-org-link-rejected',
    );
  }
}

/**
 * Validate EVERY cross-entity link this command carries BEFORE the adapter exists — so a command
 * pairing (say) a valid own-org customer with ANOTHER org's `salesInvoiceId`, or naming another
 * tenant's `procurementId`, is refused with no ERP write and no outbox commit. Runs ahead of ref
 * resolution (which itself issues ERP GETs for a GR) and ahead of `dispatchExternallyOwnedWrite`
 * (index.ts resolves the adapter first). A null/absent link is skipped — only ASSERTED links are
 * validated (an on-account receipt, or a Material Request with no vendor, legitimately carries none).
 */
export async function assertCommandLinksSameOrg(deps: ErpDispatchFactoryDeps): Promise<void> {
  const record = deps.command.record as Partial<Record<LinkField, string | null>>;
  for (const field of DOMAIN_LINK_FIELDS[deps.command.domain] ?? []) {
    const id = record[field];
    if (typeof id === 'string' && id.length > 0) {
      await assertLinkBelongsToOrg(deps.serviceClient, deps.orgId, LINK_TABLE[field], id);
    }
  }
}

/**
 * Enforce `require_project_on_si` on every SI body-building operation against the ERP project that
 * ACTUALLY resolved —
 * not merely against a non-null PMO `projectId` (the dispatch's own pre-flight already covers that).
 * A PMO project with no `project_map` entry resolves to `null`, and `bodies/salesInvoice.ts` then omits
 * the ERP `project` field entirely: the invoice posts with NO project dimension on the GL while PMO
 * reports it as project revenue. With the gate ON that silent divergence must be fatal, and fatal HERE
 * — before the adapter is constructed, so nothing is written to ERPNext.
 *
 * Gate OFF (or a non-SI/non-create command) ⇒ untouched: an unmapped project stays a legitimate
 * unattributed invoice. Gates are read from the SAME `config` the FE reads (`readProcessGates`, which
 * applies the per-key defaults — `require_project_on_si` defaults TRUE).
 */
export function assertSiProjectGate(deps: ErpDispatchFactoryDeps, binding: ExternalOrgBindingRow): void {
  const record = deps.command.record as { erp_doc_kind?: string; projectId?: string | null; verb?: unknown };
  if (record.erp_doc_kind !== 'sales-invoice') return;
  if (!buildsSalesInvoiceBody({ operation: deps.command.operation as string, record })) return;
  if (!readProcessGates(binding.config).require_project_on_si) return;
  // A MISSING projectId is the dispatch's own gate (index.ts -> 422 'project-required'), enforced
  // before this factory is ever reached — not re-thrown here with a different status. This guard owns
  // the half that check cannot see: a projectId that is present but resolves to no ERP project.
  if (!record.projectId) return;
  if (resolveErpProjectName(binding.config, record.projectId) === null) {
    throw new AppError(
      `require_project_on_si is on but project '${record.projectId}' has no ERP project mapping — ` +
        'the invoice would post with no project dimension on the ERP ledger',
      'commit-rejected',
    );
  }
}
