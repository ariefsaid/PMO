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
interface OtherSummary { kind: string; count: number; total: string | null }
/** The first capture-scope page's summary of the lines it leaves out; null when it is not a well-formed list. Absent means none. */
function parseOtherSummary(value: unknown): OtherSummary[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const groups: OtherSummary[] = [];
  for (const entry of value as Array<Record<string, unknown> | null>) {
    if (!entry || typeof entry.kind !== 'string' || !entry.kind || !Number.isInteger(entry.count) || (entry.count as number) < 1 ||
      (entry.total !== null && typeof entry.total !== 'string')) return null;
    groups.push({ kind: entry.kind, count: entry.count as number, total: entry.total as string | null });
  }
  return groups;
}
function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value); else map.set(key, [value]);
}
function trimDecimal(value: string): string { return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value; }

/** Exact net (debit minus credit) of decimal strings at the finest scale present, never below two places. Null when a value is not a plain decimal. */
function netTotal(lines: Array<{ debit: string | null; credit: string | null }>): string | null {
  // Ledger debit and credit are nullable columns: a missing amount makes the total unknown, never an error.
  if (lines.some(line => typeof line.debit !== 'string' || typeof line.credit !== 'string')) return null;
  const parts = lines.flatMap(line => [[trimDecimal(line.debit as string), 1n], [trimDecimal(line.credit as string), -1n]] as const);
  const scale = Math.max(2, ...parts.map(([value]) => value.split('.')[1]?.length ?? 0));
  try {
    const minor = parts.reduce((sum, [value, sign]) => sum + sign * BigInt(toMinorUnits(value, scale)), 0n);
    const digits = (minor < 0n ? -minor : minor).toString().padStart(scale + 1, '0');
    return `${minor < 0n ? '-' : ''}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  } catch { return null; }
}

/** What the operator should do about a feed that is not current; the last sync is the older of the two completed runs. */
function feedGuidance(health: { feed_state?: unknown; purchases_started_at?: unknown; ledger_started_at?: unknown } | null): { feed?: { state: string; last_synced_at: string | null; guidance: string } } {
  if (typeof health?.feed_state !== 'string') return {};
  const times = [health.purchases_started_at, health.ledger_started_at];
  const synced = times.every(time => typeof time === 'string') ? (times as string[]).sort()[0] : null;
  return { feed: { state: health.feed_state, last_synced_at: synced, guidance: health.feed_state === 'running' ? 'sync_running_retry_in_minutes' : 'erpnext_sync_stopped_check_integrations' } };
}

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
  let body: { action?: unknown; scope?: { projectId?: unknown }; expectedRevision?: unknown; requestId?: unknown; rows?: unknown; dryRun?: unknown };
  try { body = await req.json(); } catch { return json({ error: 'BAD_REQUEST' }, 400); }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const projectId = body?.scope?.projectId;
  if (!['preview', 'report', 'apply', 'assign'].includes(String(body?.action)) ||
      (body.action !== 'assign' && projectId !== null && (typeof projectId !== 'string' || !uuid.test(projectId))) ||
      (body.action === 'assign' && (!Array.isArray(body.rows) || body.rows.length < 1 || body.rows.length > 500 || typeof body.expectedRevision !== 'string' || !body.expectedRevision.trim() || typeof body.dryRun !== 'boolean')) ||
      (body.action === 'apply' && (typeof body.expectedRevision !== 'string' || !body.expectedRevision.trim() ||
        typeof body.requestId !== 'string' || !uuid.test(body.requestId)))) return json({ error: 'BAD_REQUEST' }, 400);
  const { data: bindings, error: bindingError } = await service.from('external_org_bindings').select('id,external_tier,config')
    .eq('org_id', profile.org_id).eq('status', 'active').not('activated_at', 'is', null).limit(2);
  if (bindingError || !bindings || bindings.length !== 1) return json({ complete: false, missing: ['binding_unavailable'], erp_write: false }, 409);
  const binding = bindings[0];
  const config = binding.config as { company?: unknown } | null;
  const adapter = await captureAdapterForOrg(binding.external_tier, service, profile.org_id, config, { erpCalls: body.action !== 'assign' });
  if (body.action === 'assign' && !adapter.capabilities?.invoiceAssignment) return json({ complete: false, missing: ['invoice_assignment', ...(!adapter.supported ? adapter.missing : [])], erp_write: false }, 409);
  if (!adapter.supported) return json({ complete: false, missing: adapter.missing, erp_write: false }, adapter.status);
  if (body.action === 'assign') {
    const caller = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data, error } = await caller.rpc('assign_capture_invoices', { p_rows: body.rows, p_expected_revision: body.expectedRevision, p_dry_run: body.dryRun });
    if (error || !data) return json({ complete: false, missing: ['assignment_unavailable'], erp_write: false }, 503);
    return json({ ...data, erp_write: false });
  }
  const company = adapter.company;
  const caller = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const docs = await collectPages(async cursor => {
    const { data, error } = await caller.rpc('purchase_capture_source_page', { p_cursor: cursor, p_project_id: projectId, p_limit: 500 });
    if (error || !data || !Array.isArray(data.sources) || typeof data.revision !== 'string') return { supported: false as const, missing: ['source_read_failed'] };
    return { supported: true as const, generation: data.revision as string, items: data.sources as RawDocument[], nextCursor: data.next_cursor as string | null };
  }, { limit: 20 });
  // The capture scope pages only the lines a capture decides on; the first page summarizes the rest per kind (#2286).
  let otherSummary: OtherSummary[] = [];
  const ledger = await collectPages<CaptureLedgerEvidence>(async cursor => {
    const { data, error } = await caller.rpc('purchase_capture_ledger_page', { p_cursor: cursor, p_limit: 500, p_project_id: projectId, p_scope: 'capture' });
    if (error || !data || !Array.isArray(data.lines) || typeof data.revision !== 'string') return { supported: false as const, missing: ['ledger_read_failed'] };
    if (cursor === null) {
      const summary = parseOtherSummary(data.other_summary);
      if (!summary) return { supported: false as const, missing: ['ledger_read_failed'] };
      otherSummary = summary;
    }
    return { supported: true as const, generation: data.revision as string, items: data.lines.map((row: unknown) => adapter.mapLedger(row)), nextCursor: data.next_cursor as string | null };
  }, { limit: 20, expectedGeneration: docs.generation });
  if (docs.missing.includes('page_limit') || ledger.missing.includes('page_limit')) {
    return json({ complete: false, missing: [...docs.missing.map(reason => reason === 'page_limit' ? 'source_limit_exceeded' : reason), ...ledger.missing.map(reason => reason === 'page_limit' ? 'ledger_limit_exceeded' : reason)],
      proposals: [], guidance: projectId === null ? 'run_per_project' : 'scope_still_exceeds_limit', revision: body.action === 'apply' ? body.expectedRevision : docs.generation,
      ...(body.action === 'apply' ? { request_id: body.requestId } : {}), erp_write: false });
  }
  const { data: health, error: healthError } = await caller.rpc('purchase_capture_feed_health');
  const missing = [...docs.missing, ...ledger.missing];
  const feedNotCurrent = healthError || health?.caught_up !== true;
  if (feedNotCurrent) missing.push('feed_not_current');
  if (health?.reason === 'ledger_currency_mismatch' || health?.ledger_currency_mismatch === true) missing.push('ledger_currency_mismatch');
  else if (typeof health?.ledger_currency !== 'string' || !health.ledger_currency) missing.push('ledger_currency_unknown');
  const feed = feedNotCurrent && !healthError ? feedGuidance(health) : {};
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
  if (kinds.size === 0 && (ledger.items.length > 0 || otherSummary.some(group => group.count > 0))) {
    const result = await precisionReader.read(company, 'journal');
    if (result.ok) ledgerScale = result.scale;
    else missing.push(result.reason);
  }
  const { data: finalWitness, error: finalWitnessError } = await caller.rpc('purchase_capture_source_page', { p_cursor: null, p_project_id: projectId, p_limit: 1 });
  if (finalWitnessError || typeof finalWitness?.revision !== 'string' || finalWitness.revision !== docs.generation) missing.push('generation_changed');
  const sources: CaptureSource[] = docs.items.map(row => adapter.mapSource(row, binding.id, precision));
  // One pass over the ledger builds every lookup the rest of the request uses (NFR-CAPV-003); each list keeps ledger order.
  const ledgerById = new Map<string, CaptureLedgerEvidence>();
  const ledgerByDocument = new Map<string, CaptureLedgerEvidence[]>();
  const ledgerByProject = new Map<string, CaptureLedgerEvidence[]>();
  for (const line of ledger.items) {
    ledgerById.set(line.id, line);
    if (line.documentId) push(ledgerByDocument, line.documentId, line);
    if (line.projectId) push(ledgerByProject, line.projectId, line);
  }
  const sourcesById = new Map<string, CaptureSource>();
  const sourcesByProject = new Map<string, CaptureSource[]>();
  for (const source of sources) {
    if (!sourcesById.has(source.id)) sourcesById.set(source.id, source);
    for (const id of new Set(source.projectIds)) push(sourcesByProject, id, source);
  }
  const classifications: Record<string, 'mapped' | 'unmapped' | 'capital_spending' | 'unknown'> = {};
  for (const source of sources) {
    const related = ledgerByDocument.get(source.id) ?? [];
    classifications[source.id] = related.some(line => line.classification === 'unknown') ? 'unknown' : related.some(line => line.classification === 'mapped') ? 'mapped' : related.some(line => line.classification === 'capital_spending') ? 'capital_spending' : related.length ? 'unmapped' : 'unknown';
  }
  const complete = docs.complete && ledger.complete && missing.length === 0;
  const proposals = proposeCapture(sources, projectId as string | null, { sourceId: binding.id, generation: docs.generation ?? '', accountScope: 'budget_map', complete, classifications });
  if (body.action === 'apply') {
    if (!complete) return json({ complete: false, missing: [...new Set(missing)], proposals, revision: docs.generation, request_id: body.requestId, ...feed, erp_write: false });
    const families = new Map<string, typeof proposals>();
    for (const proposal of proposals) {
      const source = sourcesById.get(proposal.id);
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
  // PMO-side placements, from the database's own ledger reading (an invoice no ERP project carries, placed on a project by an Admin).
  type AssignmentRow = { decision_id: string; source_id: string; source: string | null; decision: string; project_id: string | null; procurement_id: string | null;
    assignment_origin: string | null; tagged_in_erp?: boolean; erp_project_id?: string | null; erp_tag_unmapped?: boolean; placed: string; excluded: Array<{ account: string; amount: string; kind: string }> };
  let assignmentRows: AssignmentRow[] | null = [];
  {
    const { data, error } = await caller.rpc('purchase_capture_assignment_report', { p_project_id: projectId });
    if (error || !Array.isArray(data?.assignments)) { missing.push('assignment_read_failed'); assignmentRows = null; } else assignmentRows = data.assignments as AssignmentRow[];
  }
  const minor = (value: string): string | null => {
    if (ledgerScale === undefined) return null;
    try { return toMinorUnits(trimDecimal(value), ledgerScale); } catch { return null; }
  };
  const assignments = (assignmentRows ?? []).map(row => {
    const placedMinor = minor(row.placed);
    const excluded = row.excluded.map(line => ({ account: line.account, kind: line.kind, amountMinor: minor(line.amount) }));
    if (placedMinor === null || excluded.some(line => line.amountMinor === null)) missing.push('ledger_amount_unknown');
    return { decisionId: row.decision_id, sourceId: row.source_id, source: row.source, decision: row.decision, projectId: row.project_id, procurementId: row.procurement_id,
      assignmentOrigin: row.assignment_origin, taggedInErp: row.tagged_in_erp === true, erpProjectId: row.erp_project_id ?? null, erpTagUnmapped: row.erp_tag_unmapped === true, placedMinor, excluded };
  });
  const projectIds = projectId ? [projectId as string] : [...new Set([...sources.flatMap(source => source.projectIds), ...ledgerByProject.keys(),
    ...assignments.flatMap(item => item.projectId ? [item.projectId] : [])])];
  const assignmentsByProject = new Map<string, typeof assignments>();
  for (const item of assignments) if (item.projectId) push(assignmentsByProject, item.projectId, item);
  // An invoice with an active decision is listed under that decision, not as unassigned.
  const decided = new Set(assignments.map(item => item.sourceId));
  const reports = projectIds.map(id => {
    const mappedLines: CaptureLedgerLine[] = [];
    const journalDocs: CaptureSource[] = [];
    for (const line of ledgerByProject.get(id) ?? []) {
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
      documents: [...(sourcesByProject.get(id) ?? []), ...journalDocs], lines: mappedLines, ledgerGeneration: ledger.generation ?? '' });
    const mappedKinds = new Map<string, string>();
    for (const item of mappedLines) if (!mappedKinds.has(item.id)) mappedKinds.set(item.id, item.kind);
    const describe = (entry: { id: string; amountMinor: string; reason: string }) => {
      const line = ledgerById.get(entry.id);
      const document = line?.documentId ? sourcesById.get(line.documentId) : undefined;
      return { ...entry, kind: mappedKinds.get(entry.id) ?? 'other',
        state: document?.state ?? ((line?.kind ?? 'other') === 'journal' ? 'posted' : 'unknown'), source: line?.reference ?? null };
    };
    const assigned = assignmentsByProject.get(id) ?? [];
    const assignedMinor = assigned.reduce((sum, item) => sum + BigInt(item.placedMinor ?? '0'), 0n);
    // The ERP-tagged ledger total stays as the ERP reports it; the PMO-only placement is shown beside it, never inside it.
    const bridge = assignmentRows !== null && report.ledgerMinor !== null && assigned.length > 0
      ? { erpTaggedMinor: report.ledgerMinor, pmoAssignedMinor: assignedMinor.toString(), pmoReportMinor: (BigInt(report.ledgerMinor) + assignedMinor).toString() } : null;
    return { ...report, bridge, itemCoverage: { complete: false, missing: [...new Set([...report.itemCoverage.missing, 'line_evidence'])] }, needsUndo: (sourcesByProject.get(id) ?? []).flatMap(source => (source.needsUndo ?? []).map(hold => ({ sourceId: source.id, ...hold }))), remainder: report.remainder.map(describe), excluded: report.excluded.map(describe) };
  });
  // Only lines of purchase documents block a complete preview when they carry no project. Journals, payments,
  // sales, bank and other lines without a project are listed for information (other_unassigned); a line of
  // another company blocks whatever its kind.
  const purchaseKinds = new Set<string>(['order', 'receipt', 'supplier_invoice']);
  const sourceKinds = new Map(sources.map(source => [source.id, source.kind]));
  const isPurchaseLine = (line: typeof ledger.items[number]) => purchaseKinds.has(line.kind ?? 'other') || purchaseKinds.has(sourceKinds.get(line.documentId ?? '') ?? 'other');
  const unassigned: Array<{ id: string; kind: string; source: string | null; reason: string }> = [];
  // Per kind: how many lines, and the amounts whose exact net is the kind's total. A summarized kind adds its count and its
  // net total as one amount (a missing total keeps the kind's total unknown); a paged line adds itself.
  const otherByKind = new Map<string, { count: number; amounts: Array<{ debit: string | null; credit: string | null }> }>();
  const addOther = (kind: string, count: number, amount: { debit: string | null; credit: string | null }) => {
    const group = otherByKind.get(kind);
    if (group) { group.count += count; group.amounts.push(amount); } else otherByKind.set(kind, { count, amounts: [amount] });
  };
  for (const group of otherSummary) addOther(group.kind, group.count, { debit: group.total, credit: '0' });
  for (const line of ledger.items) {
    if (!(line.documentId && decided.has(line.documentId)) && (line.company !== company || (!line.projectId && isPurchaseLine(line)))) {
      unassigned.push({ id: line.id, kind: line.kind ?? 'other', source: line.reference, reason: line.company !== company ? 'company_scope_mismatch' : 'project_unmapped' });
    }
    if (line.company === company && !line.projectId && !isPurchaseLine(line)) addOther(line.kind ?? 'other', 1, line);
  }
  const proposalsById = new Map<string, (typeof proposals)[number]>();
  for (const proposal of proposals) if (!proposalsById.has(proposal.id)) proposalsById.set(proposal.id, proposal);
  const otherUnassigned = [...otherByKind.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([kind, group]) => ({ kind, count: group.count, total: netTotal(group.amounts) }));
  const unassignedDocuments = sources.filter(source => source.projectIds.length === 0 && !decided.has(source.id)).map(source => ({ id: source.id,
    kind: source.kind, state: source.state, source: source.reference ?? null,
    reason: proposalsById.get(source.id)?.reason ?? 'project_unmapped' }));
  return json({ complete: complete && missing.length === 0 && unassigned.length === 0 && reports.every(report => report.complete), revision: docs.generation,
    ...(body.action === 'preview' ? { proposals } : {}), reports, ...(assignmentRows === null ? {} : { assignments }), unassigned, other_unassigned: otherUnassigned, unassigned_documents: unassignedDocuments, missing: [...new Set(missing)], ...feed, erp_write: false });
}

if (import.meta.main) serveWithErrorReporting('purchase-capture', handlePurchaseCaptureRequest);
