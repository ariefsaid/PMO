// S21 database seam: psql/COPY transport, fixture snapshots and owned-row reconciliation.
// Moved verbatim from AC-S21-005-task-list-review.spec.ts; the journey spec owns browser actions.
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeS21CopyRow } from './AC-S21-005-fixture.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function safeFailure(code) {
  return new Error(code);
}

export function readLocalStatus() {
  const result = spawnSync('supabase', ['status', '-o', 'json'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) throw safeFailure('S21_LOCAL_SUPABASE_STATUS_UNAVAILABLE');
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw safeFailure('S21_LOCAL_SUPABASE_STATUS_INVALID');
  }
}

export function loopbackHost(hostname) {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]' || hostname === '::1';
}

export function databaseEnvironment(databaseUrl) {
  const url = new URL(databaseUrl);
  if (!loopbackHost(url.hostname) || !url.username || !url.password || !url.pathname) {
    throw safeFailure('S21_DATABASE_TARGET_NOT_LOCAL');
  }
  return {
    PATH: `/opt/homebrew/opt/libpq/bin:${process.env.PATH ?? ''}`,
    PGHOST: url.hostname.replace(/^\[|\]$/g, ''),
    PGPORT: String(url.port || 5432),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGSSLMODE: 'disable',
  };
}

export function runPsql(status, input) {
  if (!status.DB_URL) throw safeFailure('S21_DATABASE_URL_UNAVAILABLE');
  const child = spawn('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-f', '-'], {
    cwd: REPO_ROOT,
    env: databaseEnvironment(status.DB_URL),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stdout = [];
  child.stdout.on('data', (chunk) => stdout.push(chunk));
  child.stderr.resume();
  return new Promise((resolve, reject) => {
    child.once('error', () => reject(safeFailure('S21_DATABASE_COMMAND_UNAVAILABLE')));
    child.once('close', (code) => {
      if (code !== 0) return reject(safeFailure('S21_DATABASE_COMMAND_FAILED'));
      resolve(Buffer.concat(stdout).toString('utf8').trim());
    });
    child.stdin.end(input);
  });
}

export function copySql(values, statement) {
  const secretColumn = values.length === 12 ? ', secret_value text' : '';
  return [
    'CREATE TEMP TABLE s21_values (',
    '  org_id uuid, user_id uuid, project_id uuid, org_binding_id uuid, project_binding_id text,',
    `  email text, org_name text, project_code text, project_name text, secret_ref text, list_id text${secretColumn}`,
    ');',
    'COPY s21_values FROM STDIN WITH (FORMAT csv);',
    encodeS21CopyRow(values),
    '\\.',
    statement,
  ].join('\n');
}

export function fixtureValues(fixture, projectBindingId = '') {
  return [
    fixture.orgId,
    fixture.userId,
    fixture.projectId,
    fixture.orgBindingId,
    projectBindingId,
    fixture.email,
    fixture.orgName,
    fixture.projectCode,
    fixture.projectName,
    fixture.secretRef,
    fixture.listId,
  ];
}

export async function queryFixtureSnapshot(status, fixture, projectBindingId = '') {
  const sql = copySql(fixtureValues(fixture, projectBindingId), `
    SELECT jsonb_build_object(
      'organizationCount', (SELECT count(*) FROM public.organizations o, s21_values p WHERE o.id = p.org_id),
      'organizationNameCount', (SELECT count(*) FROM public.organizations o, s21_values p WHERE o.name = p.org_name),
      'organizationTestCount', (SELECT count(*) FROM public.organizations o, s21_values p WHERE o.id = p.org_id AND o.lifecycle_state = 'test'),
      'authUserIdCount', (SELECT count(*) FROM auth.users u, s21_values p WHERE u.id = p.user_id),
      'authEmailCount', (SELECT count(*) FROM auth.users u, s21_values p WHERE lower(u.email) = lower(p.email)),
      'profileCount', (SELECT count(*) FROM public.profiles u, s21_values p WHERE u.id = p.user_id),
      'projectCount', (SELECT count(*) FROM public.projects x, s21_values p WHERE x.id = p.project_id AND x.org_id = p.org_id),
      'projectCodeCount', (SELECT count(*) FROM public.projects x, s21_values p WHERE x.org_id = p.org_id AND x.code = p.project_code),
      'projectNameCount', (SELECT count(*) FROM public.projects x, s21_values p WHERE x.org_id = p.org_id AND x.name = p.project_name),
      'orgBindingCount', (SELECT count(*) FROM public.external_org_bindings b, s21_values p WHERE b.id = p.org_binding_id AND b.org_id = p.org_id AND b.external_tier = 'clickup'),
      'activeClickUpBindingCount', (SELECT count(*) FROM public.external_org_bindings b, s21_values p WHERE b.org_id = p.org_id AND b.external_tier = 'clickup' AND b.status = 'active'),
      'projectBindingCount', (SELECT count(*) FROM public.external_project_bindings b, s21_values p WHERE b.org_id = p.org_id AND b.project_id = p.project_id AND b.external_tier = 'clickup'),
      'projectBindings', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id', b.id, 'external_container_id', b.external_container_id,
          'direction', b.config->>'direction', 'linked_by', b.linked_by
        ) ORDER BY b.id)
        FROM public.external_project_bindings b, s21_values p
        WHERE b.org_id = p.org_id AND b.project_id = p.project_id AND b.external_tier = 'clickup'
      ), '[]'::jsonb),
      'stageEntries', coalesce((SELECT jsonb_agg(jsonb_build_object('id', e.id, 'stage', e.stage, 'source', e.source, 'recorded_by', e.recorded_by)) FROM public.project_stage_entries e, s21_values p WHERE e.org_id = p.org_id), '[]'::jsonb),
      'projectTaskCount', (SELECT count(*) FROM public.tasks t, s21_values p WHERE t.org_id = p.org_id),
      'domainOwnershipCount', (SELECT count(*) FROM public.external_domain_ownership d, s21_values p WHERE d.org_id = p.org_id),
      'externalRefsCount', (SELECT count(*) FROM public.external_refs r, s21_values p WHERE r.org_id = p.org_id),
      'outboxCount', (SELECT count(*) FROM public.external_command_outbox o, s21_values p WHERE o.org_id = p.org_id),
      'vaultSecretCount', (SELECT count(*) FROM vault.secrets v, s21_values p WHERE v.name = p.secret_ref),
      'vaultReaderPresent', coalesce((SELECT public.read_vault_secret(p.secret_ref) IS NOT NULL FROM s21_values p), false),
      'auditEvents', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id', a.id, 'action', a.action, 'entity_type', a.entity_type,
          'entity_id', a.entity_id, 'actor_id', a.actor_id
        ) ORDER BY a.created_at, a.id)
        FROM public.audit_events a, s21_values p WHERE a.org_id = p.org_id
      ), '[]'::jsonb),
      'historyEvents', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id', h.id, 'entity_type', h.entity_type, 'entity_id', h.entity_id,
          'op', h.op, 'actor_id', h.actor_id
        ) ORDER BY h.seq)
        FROM public.record_changes h, s21_values p WHERE h.org_id = p.org_id
      ), '[]'::jsonb),
      'projectHistoryVisible', coalesce((SELECT public.record_history_visible('project', p.project_id) FROM s21_values p), false),
      'organization', (SELECT jsonb_build_object('name', o.name, 'lifecycle_state', o.lifecycle_state)
        FROM public.organizations o, s21_values p WHERE o.id = p.org_id)
    )::text;
  `);
  const result = await runPsql(status, sql);
  try {
    return JSON.parse(result);
  } catch {
    throw safeFailure('S21_DATABASE_SNAPSHOT_INVALID');
  }
}

export function assertInitialAbsence(snapshot) {
  const counts = [
    snapshot.organizationCount, snapshot.organizationNameCount, snapshot.authUserIdCount, snapshot.authEmailCount,
    snapshot.profileCount, snapshot.projectCount, snapshot.projectCodeCount, snapshot.projectNameCount,
    snapshot.orgBindingCount, snapshot.activeClickUpBindingCount, snapshot.projectBindingCount,
    snapshot.projectTaskCount, snapshot.domainOwnershipCount, snapshot.externalRefsCount,
    snapshot.outboxCount, snapshot.vaultSecretCount,
  ];
  if (
    counts.some((count) => count !== 0) || snapshot.vaultReaderPresent || snapshot.auditEvents.length ||
    snapshot.historyEvents.length || snapshot.stageEntries.length || snapshot.projectHistoryVisible
  ) {
    throw safeFailure('S21_FIXTURE_ID_COLLISION_OR_NONEMPTY_BASELINE');
  }
}

export async function removeVaultAndOrgBinding(status, fixture) {
  const sql = copySql(fixtureValues(fixture), `
    DO $$
    DECLARE
      p record;
      v_count integer;
    BEGIN
      SELECT * INTO p FROM s21_values;
      DELETE FROM public.external_org_bindings
       WHERE id = p.org_binding_id AND org_id = p.org_id AND external_tier = 'clickup';
      GET DIAGNOSTICS v_count = ROW_COUNT;
      IF v_count <> 1 THEN RAISE EXCEPTION 'S21_OWNED_BINDING_DELETE_COUNT'; END IF;
      PERFORM public.delete_vault_secret(p.secret_ref);
    END $$;
  `);
  await runPsql(status, sql);
}

export async function assertFinalFixtureState(
  status,
  fixture,
  ledger,
  projectCreated,
  bindingCreated,
  projectDeleted,
  stageEntryId,
) {
  const snapshot = await queryFixtureSnapshot(status, fixture, ledger.ownedIds.projectBindingId ?? '');
  const expectedActions = [
    ...(projectCreated ? ['project.create'] : []),
    ...(bindingCreated ? ['integration.link'] : []),
    ...(projectDeleted ? ['project.delete'] : []),
  ].sort();
  const actualActions = snapshot.auditEvents.map((event) => event.action).sort();
  const exactHistory = projectCreated
    ? snapshot.historyEvents.length === 2 &&
      snapshot.historyEvents.some((event) => event.entity_type === 'project' &&
        event.entity_id === fixture.projectId && event.op === 'insert' && event.actor_id === fixture.userId) &&
      snapshot.historyEvents.some((event) => event.entity_type === 'project_stage_entry' &&
        event.entity_id === stageEntryId && event.op === 'insert' && event.actor_id === fixture.userId)
    : snapshot.historyEvents.length === 0;
  if (
    snapshot.organizationCount !== (ledger.steps.organization === 'verified' ? 1 : 0) ||
    snapshot.organizationNameCount !== (ledger.steps.organization === 'verified' ? 1 : 0) ||
    snapshot.organizationTestCount !== (ledger.steps.organization === 'verified' ? 1 : 0) ||
    (ledger.steps.organization === 'verified' && snapshot.organization?.name !== fixture.orgName) ||
    (ledger.steps.organization === 'verified' && snapshot.organization?.lifecycle_state !== 'test') ||
    snapshot.authUserIdCount !== 0 || snapshot.authEmailCount !== 0 || snapshot.profileCount !== 0 ||
    snapshot.projectCount !== 0 || snapshot.projectCodeCount !== 0 || snapshot.projectNameCount !== 0 ||
    snapshot.orgBindingCount !== 0 || snapshot.activeClickUpBindingCount !== 0 ||
    snapshot.projectBindingCount !== 0 || snapshot.stageEntries.length !== 0 || snapshot.projectTaskCount !== 0 ||
    snapshot.domainOwnershipCount !== 0 || snapshot.externalRefsCount !== 0 || snapshot.outboxCount !== 0 ||
    snapshot.vaultSecretCount !== 0 || snapshot.vaultReaderPresent ||
    JSON.stringify(actualActions) !== JSON.stringify(expectedActions) || !exactHistory ||
    snapshot.projectHistoryVisible
  ) {
    throw safeFailure('S21_FINAL_FIXTURE_STATE_MISMATCH');
  }
  ledger.ownedIds.auditEventIds = snapshot.auditEvents.map((event) => event.id);
  ledger.ownedIds.historyEventIds = snapshot.historyEvents.map((event) => event.id);
  ledger.steps.cleanup = 'verified';
}
