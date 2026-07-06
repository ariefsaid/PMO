#!/usr/bin/env node
/**
 * import-historical.mjs — Operator-run, service-role historical import (Deliverable 3,
 * docs/specs/onboarding-tooling.spec.md §"Deliverable 3"). Loads closed projects.csv +
 * procurement_cases.csv into a freshly-provisioned client org at terminal status,
 * summary-grade, ≤ 1 yr. NO fabricated procurement_status_events (FR-HIST-005) unless
 * --mark-provenance is passed (exactly one honest provenance row per case, FR-HIST-013).
 *
 * Usage:
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service-role key, from op-get.sh, NEVER a file> \
 *   node scripts/import-historical.mjs --org-id <uuid> --file scripts/templates/projects.csv \
 *     [--batch-id <uuid>] [--mark-provenance] [--strict-refs]
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

const RECORD_TABLE_BY_TYPE = {
  PR: 'purchase_requests', RFQ: 'rfqs', Quotation: 'procurement_quotations',
  PO: 'purchase_orders', GR: 'procurement_receipts', VI: 'procurement_invoices', Payment: 'payments',
};

function parseCsv(path) {
  const text = readFileSync(path, 'utf8').trim();
  const [headerLine, ...lines] = text.split('\n');
  const headers = headerLine.split(',');
  return lines.map((line) => {
    const cells = line.split(',');
    return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? '']));
  });
}

async function promptConfirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans); }));
}

export async function main(argv, { promptConfirmFn = promptConfirm } = {}) {
  const args = parseArgs(argv);

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

  // HIST-E002: resolve the org name, require it typed back.
  const { data: org, error: orgErr } = await supabase
    .from('organizations').select('id, name').eq('id', args.orgId).maybeSingle();
  if (orgErr || !org) {
    console.error(`✗ org_id ${args.orgId} not found. Aborting before any write.`);
    process.exitCode = 1;
    return;
  }
  const typed = await promptConfirmFn(`Type the org name to confirm ("${org.name}"): `);
  if (!requireOrgConfirmed({ resolvedOrgName: org.name, typedConfirmation: typed }).ok) {
    console.error('✗ Org name mismatch. Aborting before any write.');
    process.exitCode = 1;
    return;
  }

  console.log(`import_batch_id: ${args.batchId}`);
  const importedAt = new Date().toISOString();

  const summary = {
    projects: { created: 0, skipped: 0, failed: 0 },
    cases: { created: 0, skipped: 0, failed: 0 },
    recordsByType: {},
    references: { resolved: 0, created: 0 },
  };

  // ── projects.csv (FR-HIST-003/004/007) ──
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

      let clientCompanyId = null;
      if (row.client_company?.trim()) {
        const { action, id } = await resolveOrCreateStub(row.client_company, {
          findFn: async (name) => (await supabase.from('companies').select('id').ilike('name', name).maybeSingle()).data,
          createFn: async (name) => (await supabase.from('companies').insert({ name, type: 'Client' }).select('id').single()).data,
        });
        clientCompanyId = id;
        summary.references[action === 'found' ? 'resolved' : 'created']++;
      }

      const { error: insertErr } = await supabase.from('projects').insert({
        code: row.code, title: row.title, client_company_id: clientCompanyId,
        status: row.status, contract_value: Number(row.contract_value),
        start_date: row.start_date || null, end_date: row.end_date,
        import_batch_id: args.batchId, imported_at: importedAt, import_key: row.code,
      });
      if (insertErr) { console.error(`✗ ${row.code}: ${insertErr.message}`); summary.projects.failed++; }
      else summary.projects.created++;
    }
  }

  // ── procurement_cases.csv (FR-HIST-003/004/005/006/011) ──
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

      const { data: caseInsert, error: caseErr } = await supabase.from('procurements').insert({
        org_id: args.orgId, title: group.attrs.title ?? group.caseRef,
        status: caseRow.terminal_status, total_value: totalValue,
        import_batch_id: args.batchId, imported_at: importedAt, import_key: group.caseRef,
      }).select('id').single();
      if (caseErr) { console.error(`✗ ${group.caseRef}: ${caseErr.message}`); summary.cases.failed++; continue; }
      summary.cases.created++;

      if (args.markProvenance) {
        const event = buildProvenanceEvent({
          procurementId: caseInsert.id, orgId: args.orgId, terminalStatus: caseRow.terminal_status,
          importBatchId: args.batchId, importDate: importedAt.slice(0, 10),
        });
        await supabase.from('procurement_status_events').insert(event);
      }

      for (const row of group.rows) {
        summary.recordsByType[row.type] ??= { created: 0, skipped: 0, failed: 0 };
        const table = RECORD_TABLE_BY_TYPE[row.type];
        const { error: recErr } = await supabase.from(table).insert({
          procurement_id: caseInsert.id, reference_number: row.externalRef || null,
          status: row.status, date: row.date, amount: row.amount ? Number(row.amount) : null,
          import_batch_id: args.batchId, imported_at: importedAt,
          import_key: row.externalRef || `fp:${row.type}|${row.date}|${row.amount}|${row.vendor ?? ''}`,
        });
        if (recErr) { console.error(`✗ ${group.caseRef}/${row.type}: ${recErr.message}`); summary.recordsByType[row.type].failed++; }
        else summary.recordsByType[row.type].created++;
      }
    }
  }

  console.log(buildSummary({ importBatchId: args.batchId, ...summary }));
}

const isMain = process.argv[1] && process.argv[1].endsWith('import-historical.mjs');
if (isMain) main(process.argv.slice(2));
