import { randomUUID } from 'node:crypto';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createS21FixtureIdentity(runId = randomUUID()) {
  if (!UUID_V4.test(runId)) throw new Error('S21_FIXTURE_RUN_ID_INVALID');
  const suffix = runId.slice(0, 8).toLowerCase();
  return {
    runId,
    orgId: randomUUID(),
    userId: randomUUID(),
    projectId: randomUUID(),
    orgBindingId: randomUUID(),
    orgName: `S21-AC005-${suffix}`,
    email: `ac-s21-005-${suffix}@example.invalid`,
    displayName: `S21 Review Admin ${suffix}`,
    projectCode: `S21-${suffix}`,
    projectName: `S21 Review ${suffix}`,
    listName: `S21 Review ${suffix}`,
    secretRef: `s21-ac005-${suffix}`,
    teamId: `s21_team_${suffix}`,
    teamName: `S21 Team ${suffix}`,
    spaceId: `s21_space_${suffix}`,
    spaceName: `S21 Space ${suffix}`,
    listId: `s21_list_${suffix}`,
  };
}

/** Return the allowlisted write-ahead fields; credentials never enter this object. */
export function createS21WriteAheadLedger(fixture) {
  return {
    schemaVersion: 1,
    runId: fixture.runId,
    ownedIds: {
      orgId: fixture.orgId,
      userId: fixture.userId,
      projectId: fixture.projectId,
      orgBindingId: fixture.orgBindingId,
      projectBindingId: null,
      auditEventIds: [],
      historyEventIds: [],
    },
    ownedLabels: {
      orgName: fixture.orgName,
      email: fixture.email,
      displayName: fixture.displayName,
      projectCode: fixture.projectCode,
      projectName: fixture.projectName,
      listName: fixture.listName,
      secretRef: fixture.secretRef,
      listId: fixture.listId,
    },
    steps: {
      organization: 'not-started',
      authUser: 'not-started',
      profile: 'not-started',
      vaultAndOrgBinding: 'not-started',
      project: 'not-started',
      projectBinding: 'not-started',
      cleanup: 'not-started',
    },
    expectedRetainedEffects: {
      inertTestOrganization: true,
      projectAuditEvents: ['project.create', 'integration.link', 'project.delete'],
      projectHistoryEvents: 1,
    },
  };
}

/**
 * Keep diagnostic detail from thrown Errors in the private, mode-0600 run ledger only.
 * @param {unknown} error
 * @param {{secretValues?: string[], includeDetails?: boolean}} [options]
 */
export function captureS21FailureDiagnostic(error, { secretValues = [], includeDetails = true } = {}) {
  const secrets = secretValues
    .filter((secret) => typeof secret === 'string' && secret.length > 0)
    .slice()
    .sort((left, right) => right.length - left.length);
  const redact = (value) => secrets.reduce((result, secret) => result.split(secret).join('[REDACTED]'), value);
  if (!(error instanceof Error)) {
    return {
      name: 'NonError',
      message: includeDetails ? 'S21_NON_ERROR_THROWABLE' : null,
      stack: null,
    };
  }
  if (!includeDetails) return { name: redact(error.name), message: null, stack: null };
  return {
    name: redact(error.name),
    message: redact(error.message),
    stack: error.stack ? redact(error.stack) : null,
  };
}

/**
 * Preserve the first journey failure even when later cleanup checks also fail.
 * @param {{primaryFailure: string|null, failedJourneyStage: string|null, primaryFailureDiagnostic: unknown}} ledger
 * @param {unknown} error
 * @param {{stage: string, secretValues?: string[], includeDetails?: boolean}} options
 */
export function recordS21PrimaryFailure(ledger, error, { stage, secretValues = [], includeDetails = true }) {
  if (typeof ledger.primaryFailure === 'string') return ledger.primaryFailure;
  const code = error instanceof Error && /^S21_[A-Z0-9_]+$/.test(error.message)
    ? error.message
    : 'S21_PLAYWRIGHT_ASSERTION_FAILED';
  ledger.primaryFailure = code;
  ledger.failedJourneyStage = stage;
  ledger.primaryFailureDiagnostic = captureS21FailureDiagnostic(error, { secretValues, includeDetails });
  return code;
}

/** A single CSV record for psql COPY FROM STDIN; values stay data, not SQL or argv. */
export function encodeS21CopyRow(values) {
  if (
    !Array.isArray(values) || values.length === 0 ||
    values.some((value) => typeof value !== 'string' || /[\r\n\0]/.test(value))
  ) {
    throw new Error('S21_COPY_VALUE_INVALID');
  }
  return values.map((value) => `"${value.replaceAll('"', '""')}"`).join(',');
}
