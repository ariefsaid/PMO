import { createClient } from '@supabase/supabase-js';
import { verifyCallerJwt, jwksFromUrl, type JwksResolver } from '../../../pmo-portal/src/lib/auth/verifyCallerJwt.ts';
import { serveWithErrorReporting } from '../_shared/serveWithErrorReporting.ts';
import { captureAdapterForOrg } from '../_shared/captureAdapterForOrg.ts';
import type { CaptureLedgerEvidence } from '../../../pmo-portal/src/lib/adapterSeam/captureAdapter.ts';
import { collectPages, proposeCapture, reconcileCapture, toMinorUnits, type CaptureSource, type CaptureLedgerLine, type CaptureKind } from '../../../pmo-portal/src/lib/adapterSeam/captureHistory.ts';


let jwks: JwksResolver | null = null;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' },
});

interface RawDocument { id: string; kind: CaptureKind | null }
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
  const binding = bindings[0];
  const config = binding.config as { company?: unknown } | null;
  const adapter = await captureAdapterForOrg(binding.external_tier, service, profile.org_id, config);
  if (!adapter.supported) return json({ complete: false, missing: adapter.missing, erp_write: false }, adapter.status);
  const company = adapter.company;
  const caller = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const docs = await collectPages(async cursor => {
    const { data, error } = await caller.rpc('purchase_capture_source_page', { p_cursor: cursor, p_project_id: projectId, p_limit: 500 });
    if (error || !data || !Array.isArray(data.sources) || typeof data.revision !== 'string') return { supported: false as const, missing: ['source_read_failed'] };
    return { supported: true as const, generation: data.revision as string, items: data.sources as RawDocument[], nextCursor: data.next_cursor as string | null };
  }, { limit: 20 });
  const ledger = await collectPages<CaptureLedgerEvidence>(async cursor => {
    const { data, error } = await caller.rpc('purchase_capture_ledger_page', { p_cursor: cursor, p_limit: 500, p_project_id: projectId });
    if (error || !data || !Array.isArray(data.lines) || typeof data.revision !== 'string') return { supported: false as const, missing: ['ledger_read_failed'] };
    return { supported: true as const, generation: data.revision as string, items: data.lines.map((row: unknown) => adapter.mapLedger(row)), nextCursor: data.next_cursor as string | null };
  }, { limit: 20, expectedGeneration: docs.generation });
  if (docs.missing.includes('page_limit') || ledger.missing.includes('page_limit')) {
    return json({ complete: false, missing: [...docs.missing.map(reason => reason === 'page_limit' ? 'source_limit_exceeded' : reason), ...ledger.missing.map(reason => reason === 'page_limit' ? 'ledger_limit_exceeded' : reason)],
      proposals: [], guidance: projectId === null ? 'run_per_project' : 'scope_still_exceeds_limit', revision: body.action === 'apply' ? body.expectedRevision : docs.generation,
      ...(body.action === 'apply' ? { request_id: body.requestId } : {}), erp_write: false });
  }
  const { data: health, error: healthError } = await caller.rpc('purchase_capture_feed_health');
  const missing = [...docs.missing, ...ledger.missing];
  if (healthError || health?.caught_up !== true) missing.push('feed_not_current');
  if (typeof health?.ledger_currency !== 'string' || !health.ledger_currency) missing.push('ledger_currency_unknown');
  const precisionReader = adapter.precision;
  const kinds = new Set(docs.items.map(row => (row.kind === 'order' || row.kind === 'supplier_invoice' ? row.kind : null)).filter((x): x is 'order' | 'supplier_invoice' => x !== null));
  const precision: Partial<Record<'order' | 'supplier_invoice', number>> = {};
  for (const kind of kinds) {
    const result = await precisionReader.read(company, kind);
    if (result.ok) precision[kind] = result.scale;
    else missing.push(result.reason);
  }
  let ledgerScale = precision.order ?? precision.supplier_invoice;
  if (precision.order !== undefined && precision.supplier_invoice !== undefined && precision.order !== precision.supplier_invoice) {
    missing.push('precision_changed');
    ledgerScale = undefined;
  }
  if (kinds.size === 0 && ledger.items.length > 0) {
    const result = await precisionReader.read(company, 'journal');
    if (result.ok) ledgerScale = result.scale;
    else missing.push(result.reason);
  }
  const { data: finalWitness, error: finalWitnessError } = await caller.rpc('purchase_capture_source_page', { p_cursor: null, p_project_id: projectId, p_limit: 1 });
  if (finalWitnessError || typeof finalWitness?.revision !== 'string' || finalWitness.revision !== docs.generation) missing.push('generation_changed');
  const sources: CaptureSource[] = docs.items.map(row => adapter.mapSource(row, binding.id, precision));
  const classifications: Record<string, 'mapped' | 'unmapped' | 'capital_spending' | 'unknown'> = {};
  for (const source of sources) {
    const related = ledger.items.filter(line => line.documentId === source.id);
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
      if (!family.some(item => item.outcome === 'propose') || family.some(item => item.outcome !== 'propose' && item.outcome !== 'matched')) return [];
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
  const projectIds = projectId ? [projectId as string] : [...new Set([...sources.flatMap(source => source.projectIds), ...ledger.items.flatMap(line => line.projectId ? [line.projectId] : [])])];
  const reports = projectIds.map(id => {
    const mappedLines: CaptureLedgerLine[] = [];
    const journalDocs: CaptureSource[] = [];
    for (const line of ledger.items.filter(line => line.projectId === id)) {
      if (line.company !== company || ledgerScale === undefined || typeof health?.ledger_currency !== 'string') { missing.push('ledger_scope_unknown'); continue; }
      let amount: string;
      try { amount = (BigInt(toMinorUnits(trimDecimal(line.debit),ledgerScale)) - BigInt(toMinorUnits(trimDecimal(line.credit),ledgerScale))).toString(); }
      catch { missing.push('ledger_amount_unknown'); continue; }
      let docId = line.documentId;
      if ((line.kind ?? 'other') === 'journal' && line.journalPurchaseId) {
        docId = `journal:${line.id}`;
        journalDocs.push({ id: docId, sourceId: binding.id, version: line.version, kind: 'journal', state: 'paid', projectIds: [id], supplierId: null,
          currency: health.ledger_currency, faceMinor: null, faceScale: null, familyId: docId, purchaseId: line.journalPurchaseId, purchaseOrigin: 'captured', reference: line.reference, lines: null, missing: ['line_evidence'] });
      }
      mappedLines.push({ id: line.id, sourceId: binding.id, currency: health.ledger_currency, projectId: id, documentId: docId, amountMinor: amount,
        kind: (line.kind ?? 'other'), classification: line.classification });
    }
    const report = reconcileCapture({ scope: { sourceId: binding.id, projectId: id, currency: health?.ledger_currency ?? '', scale: ledgerScale ?? -1,
      accountScope: 'budget_map', generation: docs.generation ?? '', asOf: health?.ledger_started_at ?? '' }, complete: complete && missing.length === 0,
      documents: [...sources.filter(source => source.projectIds.includes(id)), ...journalDocs], lines: mappedLines, ledgerGeneration: ledger.generation ?? '' });
    const describe = (entry: { id: string; amountMinor: string; reason: string }) => {
      const line = ledger.items.find(item => item.id === entry.id);
      const document = sources.find(source => source.id === line?.documentId);
      return { ...entry, kind: mappedLines.find(item => item.id === entry.id)?.kind ?? 'other',
        state: document?.state ?? ((line?.kind ?? 'other') === 'journal' ? 'posted' : 'unknown'), source: line?.reference ?? null };
    };
    return { ...report, itemCoverage: { complete: false, missing: [...new Set([...report.itemCoverage.missing, 'line_evidence'])] }, needsUndo: sources.filter(source => source.projectIds.includes(id)).flatMap(source => (source.needsUndo ?? []).map(hold => ({ sourceId: source.id, ...hold }))), remainder: report.remainder.map(describe), excluded: report.excluded.map(describe) };
  });
  const unassigned = ledger.items.filter(line => !line.projectId || line.company !== company).map(line => ({ id: line.id, kind: line.kind ?? 'other', source: line.reference, reason: line.company !== company ? 'company_scope_mismatch' : 'project_unmapped' }));
  const unassignedDocuments = sources.filter(source => source.projectIds.length === 0).map(source => ({ id: source.id,
    kind: source.kind, state: source.state, source: source.reference ?? null,
    reason: proposals.find(proposal => proposal.id === source.id)?.reason ?? 'project_unmapped' }));
  return json({ complete: complete && missing.length === 0 && unassigned.length === 0 && reports.every(report => report.complete), revision: docs.generation,
    ...(body.action === 'preview' ? { proposals } : {}), reports, unassigned, unassigned_documents: unassignedDocuments, missing: [...new Set(missing)], erp_write: false });
}

if (import.meta.main) serveWithErrorReporting('purchase-capture', handlePurchaseCaptureRequest);
