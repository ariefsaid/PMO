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
 * RE-RUN SAFETY (fix-round B2, FR-HIST-011/AC-HIST-006): every write goes through insertOrSkip —
 * a same-(import_key, batch) re-run skips instead of duplicating. --dry-run performs zero writes.
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
import { computeRecordImportKey } from './lib/historicalImportKey.mjs';
import { buildRecordInsert } from './lib/historicalImportRecordInsert.mjs';
import { insertOrSkip } from './lib/historicalImportInsertOrSkip.mjs';

function parseCsv(path) {
  const text = readFileSync(path, 'utf8').trim();
  const [headerLine, ...lines] = text.split('\n');
  const headers = headerLine.split(',');
  return lines.map((line) => {
    const cells = line.split(',');
    return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? '']));
  });
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

  console.log(`import_batch_id: ${args.batchId}`);
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
      status: r.status, date: r.date, amount: r.amount, rowNumber: i + 2,
    }));
    const { groups } = groupRows(cycleRows);

    for (const group of groups) {
      const caseRow = raw.find((r) => r.case_ref === group.caseRef && r.terminal_status);
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
        const { data: proj } = await supabase.from('projects').select('id')
          .eq('org_id', args.orgId).eq('code', projectCode.trim()).maybeSingle();
        if (proj) { projectId = proj.id; summary.references.resolved++; }
        else if (args.strictRefs) {
          console.error(`HIST-E003 case ${group.caseRef}: project_code "${projectCode}" not found and --strict-refs is set.`);
          summary.cases.failed++;
          continue;
        }
      }

      // FR-HIST-012: resolve/stub vendors referenced by this case's rows (for quotations + report).
      const vendorMap = {};
      for (const r of group.rows) {
        const vk = normVendorKey(r.vendor);
        if (!vk || vendorMap[vk] !== undefined) continue;
        if (dryRun) { vendorMap[vk] = null; summary.references.resolved++; continue; }
        const { action, id } = await resolveOrCreateStub(r.vendor.trim(), {
          findFn: async (name) => (await supabase.from('companies').select('id').ilike('name', name).maybeSingle()).data,
          createFn: async (name) => (await supabase.from('companies').insert({ org_id: args.orgId, name, type: 'Vendor' }).select('id').single()).data,
        });
        vendorMap[vk] = id;
        summary.references[action === 'found' ? 'resolved' : 'created']++;
      }

      const casePayload = {
        org_id: args.orgId, title: group.attrs.title ?? group.caseRef,
        project_id: projectId, status: caseRow.terminal_status, total_value: totalValue,
        import_batch_id: args.batchId, imported_at: importedAt, import_key: group.caseRef,
      };

      let procurementId;
      let headerAction;
      if (dryRun) {
        const { data: existing } = await supabase.from('procurements').select('id')
          .eq('import_key', group.caseRef).eq('import_batch_id', args.batchId).maybeSingle();
        headerAction = existing ? 'skipped' : 'created';
        procurementId = existing?.id ?? null;
        summary.cases[headerAction]++;
      } else {
        const findCase = async () => (await supabase.from('procurements').select('id')
          .eq('import_key', group.caseRef).eq('import_batch_id', args.batchId).maybeSingle()).data;
        const res = await insertOrSkip({
          findExisting: findCase,
          insert: async () => supabase.from('procurements').insert(casePayload).select('id').single(),
          reResolve: findCase,
        });
        if (res.action === 'failed') { console.error(`✗ ${group.caseRef}: ${res.error}`); summary.cases.failed++; continue; }
        procurementId = res.id;
        headerAction = res.action;
        summary.cases[res.action]++;
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
      for (const row of group.rows) {
        summary.recordsByType[row.type] ??= { created: 0, skipped: 0, failed: 0 };
        const recordKey = computeRecordImportKey(row);
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
        payload.org_id = args.orgId;

        if (dryRun) {
          if (!procurementId) { summary.recordsByType[row.type].created++; continue; }
          const { data: existing } = await supabase.from(table).select('id')
            .eq('procurement_id', procurementId).eq('import_key', recordKey)
            .eq('import_batch_id', args.batchId).maybeSingle();
          summary.recordsByType[row.type][existing ? 'skipped' : 'created']++;
          continue;
        }

        const findRec = async () => (await supabase.from(table).select('id')
          .eq('procurement_id', procurementId).eq('import_key', recordKey)
          .eq('import_batch_id', args.batchId).maybeSingle()).data;
        const res = await insertOrSkip({
          findExisting: findRec,
          insert: async () => supabase.from(table).insert(payload).select('id').single(),
          reResolve: findRec,
        });
        if (res.action === 'failed') {
          console.error(`✗ ${group.caseRef}/${row.type}: ${res.error}`);
          summary.recordsByType[row.type].failed++;
        } else {
          if (row.type === 'VI' && res.id) groupInvoiceId = res.id; // Payment FK settlement
          summary.recordsByType[row.type][res.action]++;
        }
      }
    }
  }

  console.log(buildSummary({ importBatchId: args.batchId, ...summary }));
}

const isMain = process.argv[1] && process.argv[1].endsWith('import-historical.mjs');
if (isMain) main(process.argv.slice(2));
