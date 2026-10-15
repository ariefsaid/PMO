import assert from 'node:assert/strict';
import test from 'node:test';
import { MUTATION_CASES, parsePolicyCatalogRow, policyAlterSql, runMutationProof } from './m365-document-link-policy-mutation.mjs';

test('mutation inventory isolates every target write policy and operation', () => {
  assert.deepEqual(MUTATION_CASES.map(({ table, policy, operation }) => `${table}.${policy}:${operation}`), [
    'project_documents.project_documents_write:insert',
    'project_documents.project_documents_write:update',
    'project_documents.project_documents_write:delete',
    'procurement_documents.procurement_documents_write:insert',
    'procurement_documents.procurement_documents_write:update',
    'procurement_documents.procurement_documents_write:delete',
    'budget_version_document_links.m365_budget_links_insert:insert',
    'budget_version_document_links.m365_budget_links_delete:delete',
    'org_m365_document_settings.m365_settings_insert:insert',
    'org_m365_document_settings.m365_settings_update:update',
  ]);
});

test('catalog policy definitions are parsed and restored without widening expressions', () => {
  const policy = parsePolicyCatalogRow({
    schemaname: 'public', tablename: 'budget_version_document_links', policyname: 'm365_budget_links_insert', cmd: 'INSERT',
    qual: null, with_check: '(org_id = auth_org_id()) AND is_active_member()',
  });
  assert.deepEqual(policy, {
    schema: 'public', table: 'budget_version_document_links', name: 'm365_budget_links_insert', command: 'INSERT',
    using: null, check: '(org_id = auth_org_id()) AND is_active_member()',
  });
  assert.equal(policyAlterSql(policy, false),
    'ALTER POLICY "m365_budget_links_insert" ON "public"."budget_version_document_links" WITH CHECK ((org_id = auth_org_id()) AND is_active_member());');
  assert.equal(policyAlterSql(policy, true),
    'ALTER POLICY "m365_budget_links_insert" ON "public"."budget_version_document_links" WITH CHECK (true);');
});

test('local database mutation refuses to run without the shared DB lock', () => {
  const prior = process.env.PMO_DB_LOCK_HELD;
  delete process.env.PMO_DB_LOCK_HELD;
  try { assert.throws(runMutationProof, /with-db-lock\.sh/); }
  finally { if (prior !== undefined) process.env.PMO_DB_LOCK_HELD = prior; }
});

test('policy mutation refuses unexpected catalog identity or missing expressions', () => {
  assert.throws(() => parsePolicyCatalogRow({
    schemaname: 'private', tablename: 'budget_version_document_links', policyname: 'm365_budget_links_insert', cmd: 'INSERT',
    qual: null, with_check: 'true',
  }), /public/);
  assert.throws(() => parsePolicyCatalogRow({
    schemaname: 'public', tablename: 'budget_version_document_links', policyname: 'm365_budget_links_insert', cmd: 'INSERT',
    qual: null, with_check: null,
  }), /WITH CHECK/);
});
