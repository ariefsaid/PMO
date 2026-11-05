import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertInitialAbsence,
  copySql,
  databaseEnvironment,
  fixtureValues,
  loopbackHost,
  queryFixtureSnapshot,
} from './AC-S21-005-database.mjs';
import { createS21FixtureIdentity } from './AC-S21-005-fixture.mjs';

const TEST_RUN_ID = '11111111-2222-4333-8444-555555555555';
const TEST_FIXTURE = createS21FixtureIdentity(TEST_RUN_ID);

/** An all-clear preflight snapshot: every owned row count zero, no retained effects. */
function emptyBaselineSnapshot(overrides = {}) {
  return {
    organizationCount: 0,
    organizationNameCount: 0,
    organizationTestCount: 0,
    authUserIdCount: 0,
    authEmailCount: 0,
    profileCount: 0,
    projectCount: 0,
    projectCodeCount: 0,
    projectNameCount: 0,
    orgBindingCount: 0,
    activeClickUpBindingCount: 0,
    projectBindingCount: 0,
    projectBindings: [],
    stageEntries: [],
    projectTaskCount: 0,
    domainOwnershipCount: 0,
    externalRefsCount: 0,
    outboxCount: 0,
    vaultSecretCount: 0,
    vaultReaderPresent: false,
    auditEvents: [],
    historyEvents: [],
    projectHistoryVisible: false,
    organization: null,
    ...overrides,
  };
}

test('loopback host check accepts every loopback spelling and rejects the rest', () => {
  for (const host of ['127.0.0.1', 'localhost', '[::1]', '::1']) {
    assert.equal(loopbackHost(host), true, host);
  }
  for (const host of ['example.supabase.co', '10.0.0.1', 'db.internal', '']) {
    assert.equal(loopbackHost(host), false, host);
  }
});

test('database environment maps a loopback DB URL onto libpq variables', () => {
  const env = databaseEnvironment('postgresql://postgres:secret@127.0.0.1:54322/postgres');
  assert.equal(env.PGHOST, '127.0.0.1');
  assert.equal(env.PGPORT, '54322');
  assert.equal(env.PGUSER, 'postgres');
  assert.equal(env.PGPASSWORD, 'secret');
  assert.equal(env.PGDATABASE, 'postgres');
  assert.equal(env.PGSSLMODE, 'disable');
  assert.match(env.PATH, /libpq/);
});

test('database environment refuses any non-local or incomplete database target', () => {
  assert.throws(() => databaseEnvironment('postgresql://postgres:secret@db.example.supabase.co:5432/postgres'),
    /S21_DATABASE_TARGET_NOT_LOCAL/);
  assert.throws(() => databaseEnvironment('postgresql://postgres@127.0.0.1:54322/postgres'),
    /S21_DATABASE_TARGET_NOT_LOCAL/);
  assert.throws(() => databaseEnvironment('postgresql://postgres:secret@127.0.0.1:54322'),
    /S21_DATABASE_TARGET_NOT_LOCAL/);
});

test('COPY statement stages exactly the fixture columns and adds the secret column only for the bound write', () => {
  const withoutSecret = copySql(fixtureValues(TEST_FIXTURE), 'SELECT count(*) FROM s21_values;');
  assert.match(withoutSecret, /CREATE TEMP TABLE s21_values \(/);
  assert.doesNotMatch(withoutSecret, /secret_value/);
  assert.match(withoutSecret, /COPY s21_values FROM STDIN WITH \(FORMAT csv\);/);
  assert.match(withoutSecret, /\\./);
  assert.match(withoutSecret, /SELECT count\(\*\) FROM s21_values;/);

  const withSecret = copySql([...fixtureValues(TEST_FIXTURE), 'SENTINEL'], 'SELECT 1;');
  assert.match(withSecret, /secret_value text/);
});

test('fixture values keep the COPY column order with an optional project binding id', () => {
  assert.deepEqual(fixtureValues(TEST_FIXTURE), [
    TEST_FIXTURE.orgId,
    TEST_FIXTURE.userId,
    TEST_FIXTURE.projectId,
    TEST_FIXTURE.orgBindingId,
    '',
    TEST_FIXTURE.email,
    TEST_FIXTURE.orgName,
    TEST_FIXTURE.projectCode,
    TEST_FIXTURE.projectName,
    TEST_FIXTURE.secretRef,
    TEST_FIXTURE.listId,
  ]);
  const [projectBindingId] = fixtureValues(TEST_FIXTURE, 'binding-1').slice(4, 5);
  assert.equal(projectBindingId, 'binding-1');
});

test('snapshot query refuses to spawn psql without a database URL', async () => {
  await assert.rejects(() => queryFixtureSnapshot({}, TEST_FIXTURE), /S21_DATABASE_URL_UNAVAILABLE/);
});

test('preflight absence proof accepts an empty baseline and pins every stray-row branch', () => {
  assert.doesNotThrow(() => assertInitialAbsence(emptyBaselineSnapshot()));

  const countFields = [
    'organizationCount', 'organizationNameCount', 'authUserIdCount', 'authEmailCount',
    'profileCount', 'projectCount', 'projectCodeCount', 'projectNameCount',
    'orgBindingCount', 'activeClickUpBindingCount', 'projectBindingCount',
    'projectTaskCount', 'domainOwnershipCount', 'externalRefsCount',
    'outboxCount', 'vaultSecretCount',
  ];
  for (const field of countFields) {
    assert.throws(() => assertInitialAbsence(emptyBaselineSnapshot({ [field]: 1 })),
      /S21_FIXTURE_ID_COLLISION_OR_NONEMPTY_BASELINE/, field);
  }
  assert.throws(() => assertInitialAbsence(emptyBaselineSnapshot({ vaultReaderPresent: true })),
    /S21_FIXTURE_ID_COLLISION_OR_NONEMPTY_BASELINE/);
  assert.throws(() => assertInitialAbsence(emptyBaselineSnapshot({ auditEvents: [{ id: 'a', action: 'project.create' }] })),
    /S21_FIXTURE_ID_COLLISION_OR_NONEMPTY_BASELINE/);
  assert.throws(() => assertInitialAbsence(emptyBaselineSnapshot({ historyEvents: [{ id: 'h', op: 'insert' }] })),
    /S21_FIXTURE_ID_COLLISION_OR_NONEMPTY_BASELINE/);
  assert.throws(() => assertInitialAbsence(emptyBaselineSnapshot({ stageEntries: [{ id: 's', stage: 'Internal Project' }] })),
    /S21_FIXTURE_ID_COLLISION_OR_NONEMPTY_BASELINE/);
  assert.throws(() => assertInitialAbsence(emptyBaselineSnapshot({ projectHistoryVisible: true })),
    /S21_FIXTURE_ID_COLLISION_OR_NONEMPTY_BASELINE/);
});
