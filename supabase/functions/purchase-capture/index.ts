import { createClient } from '@supabase/supabase-js';
import { verifyCallerJwt, jwksFromUrl, type JwksResolver } from '../../../pmo-portal/src/lib/auth/verifyCallerJwt.ts';
import { serveWithErrorReporting } from '../_shared/serveWithErrorReporting.ts';
import { createCaptureAdapter as createOdooCaptureAdapter } from '../../../pmo-portal/src/lib/adapterSeam/odoo/captureHistory.ts';
import { erpClientForOrg } from '../_shared/erpClientForOrg.ts';
import { createCapturePrecisionReader } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/captureEvidence.ts';
import { normaliseDocument, toMinorUnits, type MirrorDocument } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/captureHistory.ts';
import { collectPages, proposeCapture, reconcileCapture, type CaptureSource, type CaptureLedgerLine } from '../../../pmo-portal/src/lib/adapterSeam/captureHistory.ts';


let jwks: JwksResolver | null = null;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' },
});

interface RawDocument extends MirrorDocument { project_ids: string[]; supplier_id: string | null; procurement_id: string | null; purchase_origin: CaptureSource['purchaseOrigin']; recorded_by_pmo: boolean }
interface RawLedger { id: string; erp_modified: string; company: string; project_id: string | null; voucher_type: string | null; voucher_no: string | null; debit: string; credit: string; document_id: string | null; journal_purchase_id: string | null; classification: CaptureLedgerLine['classification'] }
function trimDecimal(value: string): string { return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value; }

export async function handlePurchaseCaptureRequest(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return json('ok');
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  const token = /^Bearer\s+(.+)$/i.exec(req.headers.get('Authorization') ?? '')?.[1];
  if (!token) return json({ error: 'UNAUTHORIZED' }, 401);
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  if (!url || !serviceKey || !anonKey) return json({ error: 'MISCONFIGURED' }, 500);
  let userId: string;
  try {
    jwks ??= jwksFromUrl(`${url}/auth/v1/.well-known/jwks.json`);
    userId = (await verifyCallerJwt(token, jwks, { issuer: Deno.env.get('EDGE_JWT_ISSUER') ?? `${url}/auth/v1`, audience: 'authenticated', algorithms: ['ES256'] })).sub;
  } catch { return json({ error: 'UNAUTHORIZED' }, 401); }
  const service = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
  const { data: profile, error } = await service.from('profiles').select('org_id,role,status').eq('id', userId).single();
  if (error || !profile || profile.role !== 'Admin' || profile.status !== 'active') return json({ error: 'FORBIDDEN' }, 403);
  const { data: state, error: stateError } = await service.rpc('actor_authorization_state', { p_org_id: profile.org_id, p_user_id: userId });
  if (stateError || !state || state.active !== true || state.role !== 'Admin') return json({ error: 'FORBIDDEN' }, 403);
  let body: { action?: unknown; scope?: { projectId?: unknown }; expectedRevision?: unknown; requestId?: unknown };
  try { body = await req.json(); } catch { return json({ error: 'BAD_REQUEST' }, 400); }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const projectId = body?.scope?.projectId;
  if (!['preview', 'report', 'apply'].includes(String(body?.action)) ||
      (projectId !== null && (typeof projectId !== 'string' || !uuid.test(projectId))) ||
      (body.action === 'apply' && (typeof body.expectedRevision !== 'string' || !body.expectedRevision.trim() ||
        typeof body.requestId !== 'string' || !uuid.test(body.requestId)))) return json({ error: 'BAD_REQUEST' }, 400);
  const { data: bindings, error: bindingError } = await service.from('external_org_bindings').select('id,external_tier,config')
    .eq('org_id', profile.org_id).eq('status', 'active').not('activated_at', 'is', null).limit(2);
  if (bindingError || !bindings || bindings.length !== 1) return json({ complete: false, missing: ['binding_unavailable'], erp_write: false }, 409);
  if (bindings[0].external_tier === 'odoo') {
    const capability = await createOdooCaptureAdapter().listSources();
    return json({ complete: false, missing: ['odoo_purchase_capture', ...(!capability.supported ? capability.missing : [])], erp_write: false }, 409);
  }
  if (bindings[0].external_tier !== 'erpnext') return json({ complete: false, missing: ['unsupported_adapter'], erp_write: false }, 409);
  const binding = bindings[0];
  const config = binding.config as { company?: unknown; project_map?: Record<string, unknown> } | null;
  if (typeof config?.company !== 'string' || !config.company.trim()) return json({ complete: false, missing: ['company_unknown'], erp_write: false });
  const resolved = await erpClientForOrg(service, profile.org_id, { requireCompany: true });
  if ('refusal' in resolved || resolved.config?.company !== config.company) return json({ complete: false, missing: ['erp_reader_unavailable'], erp_write: false });
  const caller = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const docs = await collectPages(async cursor => {
    const { data, error } = await caller.rpc('purchase_capture_source_page', { p_cursor: cursor, p_project_id: null, p_limit: 500 });
    if (error || !data || !Array.isArray(data.sources) || typeof data.revision !== 'string') return { supported: false as const, missing: ['source_read_failed'] };
    return { supported: true as const, generation: data.revision as string, items: data.sources as RawDocument[], nextCursor: data.next_cursor as string | null };
  }, { limit: 20 });
  const ledger = await collectPages(async cursor => {
    const { data, error } = await caller.rpc('purchase_capture_ledger_page', { p_cursor: cursor, p_limit: 500 });
    if (error || !data || !Array.isArray(data.lines) || typeof data.revision !== 'string') return { supported: false as const, missing: ['ledger_read_failed'] };
    return { supported: true as const, generation: data.revision as string, items: data.lines as RawLedger[], nextCursor: data.next_cursor as string | null };
  }, { limit: 20, expectedGeneration: docs.generation });
  const { data: health, error: healthError } = await caller.rpc('purchase_capture_feed_health');
  const missing = [...docs.missing, ...ledger.missing];
  if (healthError || health?.caught_up !== true) missing.push('feed_not_current');
  if (typeof health?.ledger_currency !== 'string' || !health.ledger_currency) missing.push('ledger_currency_unknown');
  const precisionReader = createCapturePrecisionReader(resolved.client);
  const kinds = new Set(docs.items.map(row => row.erp_doctype === 'Purchase Order' ? 'order' : row.erp_doctype === 'Purchase Invoice' ? 'supplier_invoice' : null).filter((x): x is 'order' | 'supplier_invoice' => x !== null));
  const precision: Partial<Record<'order' | 'supplier_invoice', number>> = {};
  for (const kind of kinds) {
    const result = await precisionReader.read(config.company, kind);
    if (result.ok) precision[kind] = result.scale;
    else missing.push(result.reason);
  }
  let ledgerScale = precision.order ?? precision.supplier_invoice;
  if (precision.order !== undefined && precision.supplier_invoice !== undefined && precision.order !== precision.supplier_invoice) {
    missing.push('precision_changed');
    ledgerScale = undefined;
  }
  if (kinds.size === 0 && ledger.items.length > 0) {
    const result = await precisionReader.read(config.company, 'journal');
    if (result.ok) ledgerScale = result.scale;
    else missing.push(result.reason);
  }
  const sources: CaptureSource[] = docs.items.map(row => {
    const kind = row.erp_doctype === 'Purchase Order' ? 'order' : row.erp_doctype === 'Purchase Invoice' ? 'supplier_invoice' : null;
    const family = kind === 'order' ? `order:${row.erp_name}` : kind === 'supplier_invoice' && row.purchase_orders.length === 1 ? `order:${row.purchase_orders[0]}` : kind === 'supplier_invoice' && row.purchase_orders.length === 0 ? `invoice:${row.id}` : `other:${row.id}`;
    const scale = kind ? precision[kind] ?? null : null;
    const normalized = { ...row, net_total: row.net_total === null ? null : trimDecimal(row.net_total) };
    const source = normaliseDocument(normalized, { sourceId: binding.id, projectIds: row.project_ids, familyId: family,
      purchaseId: row.procurement_id, purchaseOrigin: row.purchase_origin, supplierId: row.supplier_id,
      scale, scaleCurrency: row.currency });
    if (row.recorded_by_pmo !== true && row.recorded_by_pmo !== false) source.missing?.push('ownership_unknown');
    return { ...source, recordedByPmo: row.recorded_by_pmo === true };
  });
  const classifications: Record<string, 'mapped' | 'unmapped' | 'capital_spending' | 'unknown'> = {};
  for (const source of sources) {
    const related = ledger.items.filter(line => line.document_id === source.id);
    classifications[source.id] = related.some(line => line.classification === 'unknown') ? 'unknown' : related.some(line => line.classification === 'mapped') ? 'mapped' : related.some(line => line.classification === 'capital_spending') ? 'capital_spending' : related.length ? 'unmapped' : 'unknown';
  }
  const complete = docs.complete && ledger.complete && missing.length === 0;
  const proposals = proposeCapture(sources, projectId as string | null, { sourceId: binding.id, generation: docs.generation ?? '', accountScope: 'budget_map', complete, classifications });
  if (body.action === 'apply') {
    if (!complete) return json({ complete: false, missing: [...new Set(missing)], proposals, revision: docs.generation, request_id: body.requestId, erp_write: false });
    const families = new Map<string, typeof proposals>();
    for (const proposal of proposals) {
      const source = sources.find(item => item.id === proposal.id);
      if (!source?.familyId) continue;
      const family = families.get(source.familyId) ?? [];
      family.push(proposal); families.set(source.familyId, family);
    }
    const groups = [...families.entries()].sort(([a], [b]) => a.localeCompare(b)).flatMap(([, family]) => {
      if (!family.length || family.some(item => item.outcome !== 'propose')) return [];
      const project = family[0].projectId;
      if (!project || family.some(item => item.projectId !== project)) return [];
      return [{ project_id: project, source_ids: family.map(item => item.id).sort() }];
    });
    let batch: { complete?: boolean; resume?: boolean; results?: Array<{ outcome?: string }>; [key: string]: unknown } | null = null;
    let batchGroups: typeof groups | null = null;
    for (let n = 0; n < 21; n++) {
      const { data, error } = await service.rpc('capture_history_batch', { p_actor_id: userId, p_project_id: projectId, p_request_id: body.requestId,
        p_revision: body.expectedRevision, p_precision: precision, p_groups: batchGroups });
      if (error || !data) return json({ complete: false, missing: ['batch_unavailable'], request_id: body.requestId, revision: body.expectedRevision, erp_write: false }, 503);
      batch = data;
      if (batch?.reason === 'batch_not_found' && batchGroups === null) { batchGroups = groups; continue; }
      if (batch?.resume !== true) break;
    }
    const refused = batch?.results?.filter(result => result.outcome === 'refused').length ?? 0;
    return json({ ...batch, complete: batch?.complete === true && refused === 0, refused, proposals,
      request_id: body.requestId, revision: body.expectedRevision, erp_write: false });
  }
  const projectIds = projectId ? [projectId as string] : [...new Set([...sources.flatMap(source => source.projectIds), ...ledger.items.flatMap(line => line.project_id ? [line.project_id] : [])])];
  const reports = projectIds.map(id => {
    const mappedLines: CaptureLedgerLine[] = [];
    const journalDocs: CaptureSource[] = [];
    for (const line of ledger.items.filter(line => line.project_id === id)) {
      if (line.company !== config.company || ledgerScale === undefined || typeof health?.ledger_currency !== 'string') { missing.push('ledger_scope_unknown'); continue; }
      let amount: string;
      try { amount = (BigInt(toMinorUnits(trimDecimal(line.debit),ledgerScale)) - BigInt(toMinorUnits(trimDecimal(line.credit),ledgerScale))).toString(); }
      catch { missing.push('ledger_amount_unknown'); continue; }
      let docId = line.document_id;
      if (line.voucher_type === 'Journal Entry' && line.journal_purchase_id) {
        docId = `journal:${line.id}`;
        journalDocs.push({ id: docId, sourceId: binding.id, version: line.erp_modified, kind: 'journal', state: 'paid', projectIds: [id], supplierId: null,
          currency: health.ledger_currency, faceMinor: null, faceScale: null, familyId: docId, purchaseId: line.journal_purchase_id, purchaseOrigin: 'captured', reference: line.voucher_no, lines: null, missing: ['line_evidence'] });
      }
      mappedLines.push({ id: line.id, sourceId: binding.id, currency: health.ledger_currency, projectId: id, documentId: docId, amountMinor: amount,
        kind: line.voucher_type === 'Journal Entry' ? 'journal' : line.voucher_type === 'Purchase Invoice' ? 'supplier_invoice' : line.voucher_type === 'Payment Entry' ? 'supplier_payment' : 'other', classification: line.classification });
    }
    const report = reconcileCapture({ scope: { sourceId: binding.id, projectId: id, currency: health?.ledger_currency ?? '', scale: ledgerScale ?? -1,
      accountScope: 'budget_map', generation: docs.generation ?? '', asOf: health?.ledger_started_at ?? '' }, complete: complete && missing.length === 0,
      documents: [...sources.filter(source => source.projectIds.includes(id)), ...journalDocs], lines: mappedLines, ledgerGeneration: ledger.generation ?? '' });
    const describe = (entry: { id: string; amountMinor: string; reason: string }) => {
      const line = ledger.items.find(item => item.id === entry.id);
      const document = sources.find(source => source.id === line?.document_id);
      return { ...entry, kind: mappedLines.find(item => item.id === entry.id)?.kind ?? 'other',
        state: document?.state ?? (line?.voucher_type === 'Journal Entry' ? 'posted' : 'unknown'), source: line?.voucher_no ?? null };
    };
    return { ...report, remainder: report.remainder.map(describe), excluded: report.excluded.map(describe) };
  });
  const unassigned = ledger.items.filter(line => !line.project_id || line.company !== config.company).map(line => ({ id: line.id, kind: line.voucher_type, source: line.voucher_no, reason: line.company !== config.company ? 'company_scope_mismatch' : 'project_unmapped' }));
  const unassignedDocuments = sources.filter(source => source.projectIds.length === 0).map(source => ({ id: source.id,
    kind: source.kind, state: source.state, source: source.reference ?? null,
    reason: proposals.find(proposal => proposal.id === source.id)?.reason ?? 'project_unmapped' }));
  return json({ complete: complete && missing.length === 0 && unassigned.length === 0 && reports.every(report => report.complete), revision: docs.generation,
    ...(body.action === 'preview' ? { proposals } : {}), reports, unassigned, unassigned_documents: unassignedDocuments, missing: [...new Set(missing)], erp_write: false });
}

if (import.meta.main) serveWithErrorReporting('purchase-capture', handlePurchaseCaptureRequest);
