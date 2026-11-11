#!/usr/bin/env node
/**
 * import-historical.mjs — Operator-run, service-role historical import (Deliverable 3,
 * docs/specs/onboarding-tooling.spec.md §"Deliverable 3"). Loads closed projects.csv +
 * procurement_cases.csv into a freshly-provisioned client org at terminal status,
 * summary-grade, ≤ 1 yr. NO fabricated procurement_status_events (FR-HIST-005) unless
 * --mark-provenance is passed (exactly one honest provenance row per case, FR-HIST-013).
 *
 * SETUP (one-time): the scripts/ dir has its own dependencies (@supabase/supabase-js, pg).
 *   npm --prefix scripts install
 * Then run from the repo root.
 *
 * Usage:
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service-role key, from op-get.sh, NEVER a file> \
 *   node scripts/import-historical.mjs --org-id <uuid> --file scripts/templates/projects.csv \
 *     [--batch-id <uuid>] [--mark-provenance] [--strict-refs] [--dry-run]
 *
 * WRITE STRATEGY (fix-round B1): the create_* RPCs are security-definer with role gates on
 * auth_role()/auth.uid(), which are NULL under the service-role connection (no JWT), so an RPC
 * call would raise "not authorized". The loader therefore writes via schema-correct RAW INSERTS
 * (historicalImportRecordInsert.mjs) that stamp org_id + the provenance columns directly — the
 * service-role bypasses RLS, and the DB partial-unique index (0072) still enforces idempotency.
 *
 * Procurement re-runs compare registered creation identities within the resolved case. The
 * operator's --batch-id resumes a registered run; --dry-run performs zero writes.
 *
 * The service-role key is loaded by the OPERATOR'S OWN SHELL (op-get.sh from 1Password vault AS,
 * per docs/environments.md) — this script NEVER reads a file or 1Password directly (NFR-ONB-007).
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import readline from 'node:readline';
import { parseArgs, requireOrgConfirmed } from './lib/historicalImportGate.mjs';
import { validateProjectRow, validateCaseRow, COMMITTED_STATUSES } from './lib/historicalImportValidate.mjs';
import { warnIfOlderThanOneYear, buildSummary } from './lib/historicalImportSummary.mjs';
import { resolveOrCreateStub, buildProvenanceEvent } from './lib/historicalImportResolve.mjs';
import { groupRows } from './lib/historicalImportGroup.mjs';
import { computeRecordImportKey, computeLegacyRecordImportKey, projectCreationFacts } from './lib/historicalImportKey.mjs';
import { buildRecordInsert } from './lib/historicalImportRecordInsert.mjs';
import { insertOrSkip } from './lib/historicalImportInsertOrSkip.mjs';

function parseCsv(path) {
  const text = readFileSync(path, 'utf8');
  const records = [];
  let record = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === '') quoted = true;
    else if (char === ',') { record.push(cell); cell = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      record.push(cell); records.push(record); record = []; cell = '';
    } else cell += char;
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field.');
  if (record.length || cell) { record.push(cell); records.push(record); }
  const [headers = [], ...rows] = records;
  return rows.filter(row => row.some(value => value !== ''))
    .map(row => Object.fromEntries(headers.map((header, i) => [header, row[i] ?? ''])));
}

function exactKeyFilter(keys) {
  return `(${keys.map(key => `"${key.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`).join(',')})`;
}

function normVendorKey(name) {
  return (name ?? '').trim().toLowerCase();
}

async function promptConfirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans); }));
}

export async function main(argv, { promptConfirmFn = promptConfirm } = {}) {
  const args = parseArgs(argv);
  const dryRun = !!args.dryRun;

  // FR-HIST-001: refuse without --org-id, before any write.
  if (!args.orgId) {
    console.error('✗ --org-id is required. Aborting before any write.');
    process.exitCode = 1;
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error('✗ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the invoking shell (op-get.sh).');
    process.exitCode = 1;
    return;
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  // HIST-E002: resolve the org name, require it typed back (skipped in --dry-run — no writes).
  const { data: org, error: orgErr } = await supabase
    .from('organizations').select('id, name').eq('id', args.orgId).maybeSingle();
  if (orgErr || !org) {
    console.error(`✗ org_id ${args.orgId} not found. Aborting before any write.`);
    process.exitCode = 1;
    return;
  }
  if (!dryRun) {
    const typed = await promptConfirmFn(`Type the org name to confirm ("${org.name}"): `);
    if (!requireOrgConfirmed({ resolvedOrgName: org.name, typedConfirmation: typed }).ok) {
      console.error('✗ Org name mismatch. Aborting before any write.');
      process.exitCode = 1;
      return;
    }
  } else {
    console.log(`[dry-run] no writes will be performed (org: ${org.name}).`);
  }

  if (args.file?.endsWith('procurement_cases.csv') && !dryRun) {
    if (argv.includes('--batch-id')) {
      const { data, error } = await supabase.from('procurement_import_runs').select('id, org_id, identity_version')
        .eq('id', args.batchId).eq('org_id', args.orgId).eq('identity_version', 2).maybeSingle();
      if (error || !data) {
        console.error('The supplied import batch is not a registered current run. Upgrade and reconcile before retrying.');
        process.exitCode = 1;
        return;
      }
    } else {
      const { data, error } = await supabase.rpc('start_procurement_import_run', { p_org_id: args.orgId });
      if (error || typeof data !== 'string' || !data) {
        console.error('Could not register an import run. Retry before importing.');
        process.exitCode = 1;
        return;
      }
      args.batchId = data;
    }
  }
  const procurementPreview = dryRun && args.file?.endsWith('procurement_cases.csv');
  if (procurementPreview) args.batchId = null;
  console.log(procurementPreview ? 'Preview only; no import run registered.' : `import_batch_id: ${args.batchId}`);
  const importedAt = new Date().toISOString();
  const prov = { importBatchId: args.batchId, importedAt };

  const summary = {
    projects: { created: 0, skipped: 0, failed: 0 },
    cases: { created: 0, skipped: 0, failed: 0 },
    recordsByType: {},
    references: { resolved: 0, created: 0 },
  };

  // ── projects.csv (FR-HIST-003/004/007/012) ──
  if (args.file?.endsWith('projects.csv')) {
    const rows = parseCsv(args.file);
    for (const row of rows) {
      const { valid, errors } = validateProjectRow(row);
      if (!valid) {
        console.error(`HIST-E001 row rejected (${row.code}): ${errors.join('; ')}`);
        summary.projects.failed++;
        continue;
      }
      const warning = warnIfOlderThanOneYear(row.end_date, new Date());
      if (warning) console.warn(`⚠ ${row.code}: ${warning}`);

      // FR-HIST-012: resolve/stub the client company + the project manager profile.
      let clientId = null;
      if (row.client_company?.trim()) {
        if (dryRun) {
          summary.references.resolved++;
        } else {
          const { action, id } = await resolveOrCreateStub(row.client_company, {
            findFn: async (name) => (await supabase.from('companies').select('id').ilike('name', name).maybeSingle()).data,
            createFn: async (name) => (await supabase.from('companies').insert({ org_id: args.orgId, name, type: 'Client' }).select('id').single()).data,
          });
          clientId = id;
          summary.references[action === 'found' ? 'resolved' : 'created']++;
        }
      }

      let projectManagerId = null;
      if (row.project_manager_email?.trim() && !dryRun) {
        const { data: pm } = await supabase
          .from('profiles').select('id').ilike('email', row.project_manager_email.trim()).maybeSingle();
        if (pm) { projectManagerId = pm.id; summary.references.resolved++; }
        else if (args.strictRefs) {
          console.error(`HIST-E003 (${row.code}): project_manager_email "${row.project_manager_email}" not found and --strict-refs is set.`);
          summary.projects.failed++;
          continue;
        }
      }

      const payload = {
        org_id: args.orgId, code: row.code, name: row.title,
        client_id: clientId, project_manager_id: projectManagerId,
        status: row.status, contract_value: Number(row.contract_value),
        budget: row.budget_total ? Number(row.budget_total) : 0,
        start_date: row.start_date || null, end_date: row.end_date || null,
        import_batch_id: args.batchId, imported_at: importedAt, import_key: row.code,
      };

      if (dryRun) {
        const { data: existing } = await supabase.from('projects').select('id')
          .eq('import_key', row.code).eq('import_batch_id', args.batchId).maybeSingle();
        if (existing) summary.projects.skipped++; else summary.projects.created++;
        continue;
      }

      const res = await insertOrSkip({
        findExisting: async () => (await supabase.from('projects').select('id')
          .eq('import_key', row.code).eq('import_batch_id', args.batchId).maybeSingle()).data,
        insert: async () => supabase.from('projects').insert(payload).select('id').single(),
      });
      if (res.action === 'failed') { console.error(`✗ ${row.code}: ${res.error}`); summary.projects.failed++; }
      else summary.projects[res.action === 'skipped' ? 'skipped' : 'created']++;
    }
  }

  // ── procurement_cases.csv (FR-HIST-003/004/005/006/011/012) ──
  if (args.file?.endsWith('procurement_cases.csv')) {
    const raw = parseCsv(args.file);
    const cycleRows = raw.map((r, i) => ({
      caseRef: r.case_ref, type: r.type, project: r.project_code, title: r.title,
      caseStatus: r.terminal_status, vendor: r.vendor, externalRef: r.reference_number,
      status: r.status, date: r.date, amount: r.amount,
      // #505: VI rows must carry both, or buildRecordInsert rejects the row (no default — see there).
      taxTreatment: r.tax_treatment, taxAmount: r.tax_amount,
      rowNumber: i + 2,
    }));
    const { groups } = groupRows(cycleRows);
    const refs = [...new Set([...cycleRows.map(row => row.caseRef), ...groups.map(group => group.caseRef)].filter(ref => typeof ref === 'string' && ref.trim()))];
    const normalized = new Map();
    try {
      for (let start = 0; start < refs.length; start += 200) {
        const chunk = refs.slice(start, start + 200);
        const { data, error } = await supabase.rpc('normalize_procurement_import_refs', { p_refs: chunk });
        if (error) throw error;
        if (!Array.isArray(data) || data.length !== chunk.length) throw new Error('Invalid normalization response');
        for (const item of data) {
          if (typeof item.input_ref !== 'string' || typeof item.normalized_ref !== 'string') throw new Error('Invalid normalization response');
          normalized.set(item.input_ref, item.normalized_ref);
        }
        if (chunk.some(ref => !normalized.has(ref))) throw new Error('Incomplete normalization response');
      }
    } catch (error) {
      console.error(`Case normalization failed: ${error.message ?? error}`);
      process.exitCode = 1;
      return;
    }
    const byNormalized = new Map();
    const ambiguous = new Set();
    for (const group of groups) {
      const key = normalized.get(group.caseRef);
      if (key === undefined || group.rows.some(row => normalized.get(row.caseRef) !== key)) ambiguous.add(group);
      const owners = byNormalized.get(key) ?? [];
      owners.push(group);
      byNormalized.set(key, owners);
    }
    for (const owners of byNormalized.values()) if (owners.length > 1) for (const group of owners) ambiguous.add(group);

    for (const group of groups) {
      if (ambiguous.has(group)) {
        console.error(`✗ ${group.caseRef}: ambiguous case references require reconciliation.`);
        summary.cases.failed++;
        for (const row of group.rows) {
          summary.recordsByType[row.type] ??= { created: 0, skipped: 0, failed: 0 };
          summary.recordsByType[row.type].failed++;
        }
        continue;
      }
      const caseRow = group.rows.map(row => raw[row.rowNumber - 2]).find(row => row?.terminal_status);
      const { valid, errors } = validateCaseRow(caseRow ?? {});
      if (!valid) {
        console.error(`HIST-E001 case rejected (${group.caseRef}): ${errors.join('; ')}`);
        summary.cases.failed++;
        continue;
      }

      const totalValue = COMMITTED_STATUSES.includes(caseRow.terminal_status)
        ? Number(caseRow.total_value) : (caseRow.total_value ? Number(caseRow.total_value) : 0);

      // FR-HIST-012 / AC-HIST-004a: link the case to its project via project_code → project_id,
      // so imported cases appear in that project's committed-spend sum.
      let projectId = null;
      const projectCode = group.rows.map((r) => r.project).find((p) => p?.trim());
      if (projectCode?.trim()) {
        const { data: proj, error: projectError } = await supabase.from('projects').select('id')
          .eq('org_id', args.orgId).eq('code', projectCode.trim()).maybeSingle();
        if (projectError) {
          console.error(`✗ ${group.caseRef}: project lookup failed; retry this case.`);
          summary.cases.failed++;
          continue;
        }
        if (proj) { projectId = proj.id; summary.references.resolved++; }
        else if (args.strictRefs) {
          console.error(`HIST-E003 case ${group.caseRef}: project_code "${projectCode}" not found and --strict-refs is set.`);
          summary.cases.failed++;
          continue;
        }
      }

      // FR-HIST-012: resolve/stub vendors referenced by this case's rows (for quotations + report).
      const vendorMap = {};
      const unresolvedVendors = new Map();
      let vendorError = false;
      for (const r of group.rows) {
        const vk = normVendorKey(r.vendor);
        if (!vk || vendorMap[vk] !== undefined) continue;
        try {
          const { data, error } = await supabase.from('companies').select('id').eq('org_id', args.orgId).ilike('name', r.vendor.trim()).maybeSingle();
          if (error) throw error;
          if (data) { vendorMap[vk] = data.id; summary.references.resolved++; }
          else {
            // Only a comparison token: never use it as a database UUID or probe candidate.
            vendorMap[vk] = `provisional-vendor:${vk}`;
            unresolvedVendors.set(vk, r.vendor.trim());
          }
        } catch (error) {
          console.error(`✗ ${group.caseRef}: vendor lookup failed; retry this case.`);
          vendorError = true;
          break;
        }
      }
      if (vendorError) { summary.cases.failed++; continue; }

      const incomingKeys = new Map();
      let invalidIdentity = false;
      for (const row of group.rows) {
        try {
          const previewInvoice = row.type === 'Payment' && group.rows.some(item => item.type === 'VI') ? 'pending-invoice' : null;
          const { payload } = buildRecordInsert(row, null, vendorMap, { ...prov, importKey: '', invoiceId: previewInvoice });
          const key = `${row.type}:${computeRecordImportKey(row, projectCreationFacts(row.type, payload))}`;
          const numbers = incomingKeys.get(key) ?? [];
          numbers.push(row.rowNumber);
          incomingKeys.set(key, numbers);
        } catch (error) {
          console.error(`✗ ${group.caseRef}/${row.type}: ${error.message}`);
          invalidIdentity = true;
        }
      }
      const duplicates = [...incomingKeys.values()].filter(numbers => numbers.length > 1);
      if (invalidIdentity || duplicates.length) {
        if (duplicates.length) console.error(`✗ ${group.caseRef}: duplicate source identities on rows ${duplicates.flat().join(', ')} require reconciliation.`);
        summary.cases.failed++;
        for (const row of group.rows) {
          summary.recordsByType[row.type] ??= { created: 0, skipped: 0, failed: 0 };
          summary.recordsByType[row.type].failed++;
        }
        continue;
      }

      if (!dryRun) {
        try {
          for (const [key, name] of unresolvedVendors) {
            const created = await supabase.from('companies').insert({ org_id: args.orgId, name, type: 'Vendor' }).select('id').single();
            if (created.error || !created.data?.id) throw created.error ?? new Error('Vendor creation returned no ID.');
            vendorMap[key] = created.data.id;
            summary.references.created++;
          }
        } catch (error) {
          console.error(`✗ ${group.caseRef}: vendor creation failed; retry this case.`);
          summary.cases.failed++;
          continue;
        }
      }

      const casePayload = {
        org_id: args.orgId, title: group.attrs.title ?? group.caseRef,
        project_id: projectId, status: caseRow.terminal_status, total_value: totalValue,
        import_batch_id: args.batchId, imported_at: importedAt, import_key: group.caseRef,
      };

      const findCases = async () => {
        const result = [];
        let afterKey = null, afterId = null;
        for (;;) {
          const { data, error } = await supabase.rpc('lookup_procurement_import_cases', {
            p_refs: [group.caseRef], p_after_key: afterKey, p_after_id: afterId, p_limit: 200, p_org_id: args.orgId,
          });
          if (error) throw error;
          if (!Array.isArray(data) || data.some(item => typeof item.id !== 'string' || typeof item.normalized_ref !== 'string')) throw new Error('Invalid case lookup response');
          result.push(...data);
          if (data.length < 200) return result;
          afterKey = data[data.length - 1].normalized_ref;
          afterId = data[data.length - 1].id;
        }
      };
      let procurementId;
      let headerAction;
      try {
        let matches = await findCases();
        if (!dryRun) matches = await findCases();
        if (matches.length > 1) throw new Error('Multiple matching cases require reconciliation.');
        if (matches.length === 1) {
          procurementId = matches[0].id;
          headerAction = 'skipped';
        } else if (dryRun) {
          procurementId = null;
          headerAction = 'created';
        } else {
          const { data, error } = await supabase.from('procurements').insert(casePayload).select('id').single();
          if (error) throw error;
          if (!data?.id) throw new Error('Case creation returned no ID.');
          procurementId = data.id;
          headerAction = 'created';
        }
        summary.cases[headerAction]++;
      } catch (error) {
        console.error(`✗ ${group.caseRef}: ${error.message ?? error}`);
        summary.cases.failed++;
        continue;
      }

      if (args.markProvenance && headerAction === 'created' && procurementId && !dryRun) {
        const event = buildProvenanceEvent({
          procurementId, orgId: args.orgId, terminalStatus: caseRow.terminal_status,
          importBatchId: args.batchId, importDate: importedAt.slice(0, 10),
        });
        await supabase.from('procurement_status_events').insert(event);
      }

      // ── Records (schema-correct per type, re-run-safe, VI id tracked for Payment FK) ──
      let groupInvoiceId = null;
      let invoiceState = 'none';
      const invoiceCount = group.rows.filter(row => row.type === 'VI').length;
      const order = ['PR', 'RFQ', 'Quotation', 'PO', 'GR', 'VI', 'Payment'];
      for (const row of [...group.rows].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type))) {
        summary.recordsByType[row.type] ??= { created: 0, skipped: 0, failed: 0 };
        if (row.type === 'Payment' && invoiceCount && (invoiceCount !== 1 || invoiceState === 'none' || invoiceState === 'failed')) {
          console.error(`✗ ${group.caseRef}/Payment: linked invoice could not be uniquely resolved.`);
          summary.recordsByType[row.type].failed++;
          continue;
        }
        let recordKey = computeLegacyRecordImportKey(row);
        let table, payload;
        try {
          ({ table, payload } = buildRecordInsert(
            row, procurementId, vendorMap,
            { ...prov, importKey: recordKey, invoiceId: groupInvoiceId },
          ));
        } catch (err) {
          console.error(`✗ ${group.caseRef}/${row.type}: ${err.message}`);
          summary.recordsByType[row.type].failed++;
          continue;
        }
        recordKey = computeRecordImportKey(row, projectCreationFacts(row.type, payload));
        payload.import_key = recordKey;
        payload.org_id = args.orgId;

        const oldKey = computeLegacyRecordImportKey(row);
        const facts = projectCreationFacts(row.type, payload);
        const probe = async () => {
          const candidates = [];
          let cursor;
          for (;;) {
            let query = supabase.from(table).select('id, import_key, import_batch_id, import_identity_version, import_identity_facts')
              .eq('procurement_id', procurementId).filter('import_key', 'in', exactKeyFilter([...new Set(((row.type === 'Payment' && invoiceState === 'new') || (row.type === 'Quotation' && unresolvedVendors.has(normVendorKey(row.vendor)) && dryRun)) && !row.externalRef?.trim() ? [oldKey] : [oldKey, recordKey])])).order('id');
            if (cursor) query = query.gt('id', cursor);
            const { data, error } = await query.limit(200);
            if (error) throw error;
            if (!Array.isArray(data)) throw new Error('Invalid record lookup response');
            candidates.push(...data);
            if (data.length < 200) break;
            cursor = data[data.length - 1].id;
          }
          const unknown = candidates.find(item => item.import_identity_version !== 2 || !Array.isArray(item.import_identity_facts));
          if (unknown) return { action: 'failed', id: unknown.id, error: 'Existing source requires reconciliation.' };
          const match = candidates.find(item => item.import_key === recordKey);
          if (!match) return { action: 'created' };
          if (row.type === 'Payment' && invoiceState === 'new') return { action: 'failed', id: match.id, error: 'Existing source requires reconciliation.' };
          return JSON.stringify(match.import_identity_facts) === JSON.stringify(facts)
            ? { action: 'skipped', id: match.id }
            : { action: 'failed', id: match.id, error: 'Changed source requires reconciliation.' };
        };
        try {
          let res = procurementId ? await probe() : { action: 'created' };
          if (!dryRun) {
            res = await probe();
            if (res.action === 'created') {
              const { data, error } = await supabase.from(table).insert(payload).select('id').single();
              if (error?.code === '23505') {
                res = await probe();
                if (res.action === 'created') throw error;
              } else if (error) throw error;
              else if (!data?.id) throw new Error('Record creation returned no ID.');
              else res = { action: 'created', id: data.id };
            }
          }
          if (res.action === 'failed') console.error(`✗ ${group.caseRef}/${row.type}: ${res.error}`);
          if (row.type === 'VI') {
            if (res.id && res.action !== 'failed') { groupInvoiceId = res.id; invoiceState = 'resolved'; }
            else invoiceState = res.action === 'created' && dryRun ? 'new' : 'failed';
          }
          summary.recordsByType[row.type][res.action]++;
        } catch (err) {
          console.error(`✗ ${group.caseRef}/${row.type}: ${err.message ?? err}`);
          if (row.type === 'VI') invoiceState = 'failed';
          summary.recordsByType[row.type].failed++;
        }
      }
    }
  }

  console.log(buildSummary({ importBatchId: procurementPreview ? 'not registered (preview)' : args.batchId, ...summary }));
}

const isMain = process.argv[1] && process.argv[1].endsWith('import-historical.mjs');
if (isMain) main(process.argv.slice(2));
