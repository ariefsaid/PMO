// S21 harness seam: one per-run fixture interface owning setup, the write-ahead ledger,
// private evidence, reload diagnostics and owned cleanup for the AC-S21-005 journey.
// Moved verbatim from AC-S21-005-task-list-review.spec.ts; the spec owns browser actions.
import { createClient } from '@supabase/supabase-js';
import { chmod, mkdir, mkdtemp, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  assertFinalFixtureState,
  assertInitialAbsence,
  copySql,
  loopbackHost,
  queryFixtureSnapshot,
  readLocalStatus,
  removeVaultAndOrgBinding,
  runPsql,
} from './AC-S21-005-database.mjs';
import {
  captureS21FailureDiagnostic,
  createS21FixtureIdentity,
  createS21WriteAheadLedger,
  recordS21PrimaryFailure,
} from './AC-S21-005-fixture.mjs';
import {
  classifyS21DiagnosticEndpoint,
  createS21ReloadDiagnostic,
} from './AC-S21-005-diagnostics.mjs';
import {
  aggregateS21BrowserGuardSnapshots,
  S21_MAX_CLICKUP_GETS,
  S21_MAX_HANDLER_POSTS,
  validateS21TransportSummary,
} from './AC-S21-005-transport.mjs';
import { runS21FixtureCleanup } from './AC-S21-005-lifecycle.mjs';
import {
  installBrowserRouteGuard,
  startHandlerServer,
  stopHandlerServer,
} from './AC-S21-005-runtime.mjs';

function safeFailure(code) {
  return new Error(code);
}

function createAdminClient(url, key) {
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

async function saveLedger(pathname, ledger) {
  const nextPath = `${pathname}.next`;
  await writeFile(nextPath, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });
  await chmod(nextPath, 0o600);
  await rename(nextPath, pathname);
  await chmod(pathname, 0o600);
}

async function makeEvidencePath() {
  const base = process.env.S21_EVIDENCE_DIR || tmpdir();
  await mkdir(base, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(path.join(base, 's21-ac005-'));
  await chmod(directory, 0o700);
  return {
    directory,
    ledgerPath: path.join(directory, 'write-ahead-ledger.json'),
    failureScreenshotPath: path.join(directory, 'first-failure.png'),
  };
}

async function assertSingleRow(query, failureCode) {
  const { data, error } = await query;
  if (error || !data) throw safeFailure(failureCode);
  if (data.length > 1) throw safeFailure(`${failureCode}_MULTIPLE`);
  return data[0] ?? null;
}

async function projectBindingReadback(db, fixture) {
  const { data, error } = await db
    .from('external_project_bindings')
    .select('id, org_id, project_id, external_tier, external_container_id, config, linked_by')
    .eq('org_id', fixture.orgId)
    .eq('project_id', fixture.projectId)
    .eq('external_tier', 'clickup');
  if (error || !data) throw safeFailure('S21_PROJECT_BINDING_READBACK_FAILED');
  if (data.length > 1) throw safeFailure('S21_PROJECT_BINDING_MULTIPLE');
  return data[0] ?? null;
}

async function visibleAny(locator) {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    if (await locator.nth(index).isVisible()) return true;
  }
  return false;
}

async function captureS21ReloadDom(page, fixture) {
  const compactCard = page.getByTestId('project-integrations-compact');
  const clickupCard = compactCard.locator('[data-tier="clickup"]');
  return {
    tasksHeadingVisible: await visibleAny(page.getByText('Tasks', { exact: true })),
    emptyTaskStateVisible: await visibleAny(page.getByText('No tasks yet', { exact: true })),
    bindingLoadingVisible: await visibleAny(page.getByTestId('project-integrations-loading')),
    compactCardPresent: (await compactCard.count()) > 0,
    compactCardUnique: (await compactCard.count()) === 1,
    clickupTierCardPresent: (await clickupCard.count()) > 0,
    bindingErrorVisible: await visibleAny(clickupCard.getByText(/Failed to load|Project link details could not be refreshed/)),
    listErrorVisible: await visibleAny(clickupCard.getByText(/Failed to load lists|List details could not be refreshed/)),
    listDetailsLoadingVisible: await visibleAny(clickupCard.getByText(/Loading list details; saved list ID:/)),
    // SUB-F: the linked project is one line, "Linked to ClickUp list <name> · Unlink".
    savedListIdentityVisible: await visibleAny(clickupCard.getByText(`Linked to ClickUp list ${fixture.listName}`)),
  };
}

export function createS21JourneyHarness() {
  /**
   * @typedef {ReturnType<typeof import('./AC-S21-005-fixture.mjs').createS21FixtureIdentity>} S21FixtureIdentity
   * @typedef {ReturnType<typeof import('./AC-S21-005-fixture.mjs').createS21WriteAheadLedger>} S21WriteAheadLedger
   * @typedef {Awaited<ReturnType<typeof import('./AC-S21-005-database.mjs').readLocalStatus>>} S21LocalStatus
   * @typedef {ReturnType<typeof import('./AC-S21-005-diagnostics.mjs').createS21ReloadDiagnostic>} S21ReloadDiagnostic
   * @typedef {Awaited<ReturnType<typeof import('./AC-S21-005-runtime.mjs').startHandlerServer>>} S21HandlerServer
   * @typedef {{
   *   snapshot: () => { handlerPosts: number, clickupOnboardRequests: number },
   *   blocked: Record<string, number>,
   * }} S21PageGuard
   * @typedef {{
   *   status: S21LocalStatus | null,
   *   serviceUrl: string,
   *   serviceKey: string,
   *   anonKey: string,
   *   apiOrigin: string | null,
   *   appOrigin: string | null,
   *   fixture: S21FixtureIdentity,
   *   ledger: S21WriteAheadLedger,
   *   journeyStage: string | null,
   *   evidence: { directory: string, ledgerPath: string, failureScreenshotPath: string },
   *   ledgerPath: string | null,
   *   initialAdmin: ReturnType<typeof createClient>,
   *   actorClient: ReturnType<typeof createClient>,
   *   actorAuthenticated: boolean,
   *   browserRouteGuards: S21PageGuard[],
   *   handlerServer: S21HandlerServer | null,
   *   reloadDiagnostic: S21ReloadDiagnostic | null,
   *   primaryFailure: unknown,
   *   cleanupFailed: boolean,
   *   cleanupFailureErrors: Error[],
   *   projectCreated: boolean,
   *   stageEntryId: string | null,
   *   bindingCreated: boolean,
   *   projectDeleted: boolean,
   *   fixturePreflightPassed: boolean,
   *   browserAdminLoginConfirmed: boolean,
   *   ephemeralPassword: string | null,
   *   vaultSecretSentinel: string | null,
   *   actorAccessToken: string | null,
   *   actorRefreshToken: string | null,
   * }} S21HarnessState
   * @type {S21HarnessState}
   */
  const state = {
    status: null,
    serviceUrl: '',
    serviceKey: '',
    anonKey: '',
    apiOrigin: null,
    appOrigin: null,
    fixture: null,
    ledger: null,
    journeyStage: null,
    evidence: null,
    ledgerPath: null,
    initialAdmin: null,
    actorClient: null,
    actorAuthenticated: false,
    browserRouteGuards: [],
    handlerServer: null,
    reloadDiagnostic: null,
    primaryFailure: null,
    cleanupFailed: false,
    cleanupFailureErrors: [],
    projectCreated: false,
    stageEntryId: null,
    bindingCreated: false,
    projectDeleted: false,
    fixturePreflightPassed: false,
    browserAdminLoginConfirmed: false,
    ephemeralPassword: null,
    vaultSecretSentinel: null,
    actorAccessToken: null,
    actorRefreshToken: null,
  };

  function setJourneyStage(stage) {
    state.journeyStage = stage;
    if (state.ledger) state.ledger.journeyStage = stage;
  }

  function markCleanupFailure(step) {
    state.cleanupFailed = true;
    state.ledger.cleanupFailureSteps.push(step);
    const code = `S21_CLEANUP_${step.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}`;
    state.cleanupFailureErrors.push(safeFailure(code));
  }

  /** Provisions identity, write-ahead ledger, evidence and clients before the journey starts. */
  async function initRun(deps = {}) {
    const status = deps.status ?? readLocalStatus();
    state.status = status;
    state.serviceUrl = status.API_URL ?? '';
    state.serviceKey = status.SERVICE_ROLE_KEY ?? '';
    state.anonKey = status.ANON_KEY ?? '';
    if (!state.serviceUrl || !state.serviceKey || !state.anonKey || !status.DB_URL) throw safeFailure('S21_LOCAL_CONFIG_UNAVAILABLE');
    state.apiOrigin = new URL(state.serviceUrl).origin;
    if (!loopbackHost(new URL(state.serviceUrl).hostname)) throw safeFailure('S21_API_TARGET_NOT_LOCAL');

    state.fixture = createS21FixtureIdentity();
    state.ledger = createS21WriteAheadLedger(state.fixture);
    state.journeyStage = 'fixture-preflight';
    state.ledger.journeyStage = state.journeyStage;
    state.ledger.failedJourneyStage = null;
    state.ledger.primaryFailureDiagnostic = null;
    state.ledger.reloadDiagnostic = null;
    state.ledger.failureScreenshot = null;
    state.ledger.requestCaps = { clickupGets: S21_MAX_CLICKUP_GETS, handlerPosts: S21_MAX_HANDLER_POSTS };
    state.ledger.handlerResponseStatusCounts = {};
    state.ledger.browserBlockedByReason = {};
    state.ledger.transportSummary = null;
    state.ledger.primaryFailure = null;
    state.ledger.cleanupFailureSteps = [];
    state.evidence = await makeEvidencePath();
    state.ledgerPath = state.evidence.ledgerPath;
    state.initialAdmin = createAdminClient(state.serviceUrl, state.serviceKey);
    state.actorClient = createAdminClient(state.serviceUrl, state.anonKey);
    state.actorAuthenticated = false;
    state.browserRouteGuards = [];
    state.handlerServer = null;
    state.reloadDiagnostic = null;
    state.primaryFailure = null;
    state.cleanupFailed = false;
    state.cleanupFailureErrors = [];
    state.projectCreated = false;
    state.stageEntryId = null;
    state.bindingCreated = false;
    state.projectDeleted = false;
    state.fixturePreflightPassed = false;
    state.browserAdminLoginConfirmed = false;
    state.ephemeralPassword = null;
    state.vaultSecretSentinel = null;
    state.actorAccessToken = null;
    state.actorRefreshToken = null;

    await saveLedger(state.ledgerPath, state.ledger);
  }

  async function setup({ appBaseUrl }) {
    await initRun();
    try {
      assertInitialAbsence(await queryFixtureSnapshot(state.status, state.fixture));
      state.fixturePreflightPassed = true;

      setJourneyStage('organization');
      state.ledger.steps.organization = 'in-flight';
      await saveLedger(state.ledgerPath, state.ledger);
      const orgWrite = await state.initialAdmin.from('organizations').insert({
        id: state.fixture.orgId,
        name: state.fixture.orgName,
        default_currency: 'IDR',
        default_locale: 'en',
        default_number_locale: 'en-US',
        default_timezone: 'Asia/Jakarta',
        lifecycle_state: 'test',
      });
      const { data: orgRead, error: orgReadError } = await state.initialAdmin
        .from('organizations')
        .select('id, name, lifecycle_state, default_currency, default_locale, default_number_locale, default_timezone')
        .eq('id', state.fixture.orgId)
        .maybeSingle();
      if (
        orgReadError || !orgRead || orgRead.name !== state.fixture.orgName || orgRead.lifecycle_state !== 'test' ||
        orgRead.default_currency !== 'IDR' || orgRead.default_locale !== 'en' ||
        orgRead.default_number_locale !== 'en-US' || orgRead.default_timezone !== 'Asia/Jakarta'
      ) throw safeFailure('S21_ORGANIZATION_WRITE_NOT_RECONCILED');
      void orgWrite;
      state.ledger.steps.organization = 'verified';
      await saveLedger(state.ledgerPath, state.ledger);

      setJourneyStage('auth-user');
      state.ledger.steps.authUser = 'in-flight';
      await saveLedger(state.ledgerPath, state.ledger);
      state.ephemeralPassword = `${crypto.randomUUID()}-Aa1!`;
      const userWrite = await state.initialAdmin.auth.admin.createUser({
        id: state.fixture.userId,
        email: state.fixture.email,
        password: state.ephemeralPassword,
        email_confirm: true,
      });
      const { data: authRead } = await state.initialAdmin.auth.admin.getUserById(state.fixture.userId);
      if (userWrite.error && !authRead.user) throw safeFailure('S21_AUTH_USER_WRITE_NOT_RECONCILED');
      if (!authRead.user || authRead.user.id !== state.fixture.userId || authRead.user.email !== state.fixture.email) {
        throw safeFailure('S21_AUTH_USER_IDENTITY_MISMATCH');
      }
      state.ledger.steps.authUser = 'verified';
      await saveLedger(state.ledgerPath, state.ledger);

      setJourneyStage('profile');
      state.ledger.steps.profile = 'in-flight';
      await saveLedger(state.ledgerPath, state.ledger);
      const profileWrite = await state.initialAdmin.from('profiles').insert({
        id: state.fixture.userId,
        org_id: state.fixture.orgId,
        email: state.fixture.email,
        full_name: state.fixture.displayName,
        role: 'Admin',
        status: 'active',
      });
      const { data: profileRead, error: profileReadError } = await state.initialAdmin
        .from('profiles')
        .select('id, org_id, email, full_name, role, status')
        .eq('id', state.fixture.userId)
        .maybeSingle();
      if (
        profileReadError || !profileRead || profileRead.org_id !== state.fixture.orgId ||
        profileRead.email !== state.fixture.email || profileRead.full_name !== state.fixture.displayName ||
        profileRead.role !== 'Admin' || profileRead.status !== 'active'
      ) throw safeFailure('S21_PROFILE_WRITE_NOT_RECONCILED');
      void profileWrite;
      state.ledger.steps.profile = 'verified';
      await saveLedger(state.ledgerPath, state.ledger);

      setJourneyStage('fixture-admin-login');
      const login = await state.actorClient.auth.signInWithPassword({ email: state.fixture.email, password: state.ephemeralPassword });
      if (login.error || !login.data.session || login.data.user.id !== state.fixture.userId) {
        throw safeFailure('S21_FIXTURE_ACTOR_AUTHENTICATION_FAILED');
      }
      state.actorAuthenticated = true;
      state.actorAccessToken = login.data.session.access_token;
      state.actorRefreshToken = login.data.session.refresh_token;

      setJourneyStage('project-create-and-audit');
      state.ledger.steps.project = 'in-flight';
      await saveLedger(state.ledgerPath, state.ledger);
      const projectWrite = await state.actorClient.from('projects').insert({
        id: state.fixture.projectId,
        org_id: state.fixture.orgId,
        code: state.fixture.projectCode,
        name: state.fixture.projectName,
        status: 'Internal Project',
        project_manager_id: null,
      }).select('id').single();
      const { data: projectRead, error: projectReadError } = await state.initialAdmin
        .from('projects')
        .select('id, org_id, code, name, status, project_manager_id')
        .eq('id', state.fixture.projectId)
        .maybeSingle();
      if (
        projectReadError || !projectRead || projectRead.org_id !== state.fixture.orgId ||
        projectRead.code !== state.fixture.projectCode || projectRead.name !== state.fixture.projectName ||
        projectRead.status !== 'Internal Project' || projectRead.project_manager_id !== null
      ) throw safeFailure('S21_PROJECT_WRITE_NOT_RECONCILED');
      state.projectCreated = true;
      // The exact authenticated row readback is authoritative after an unknown insert response.
      void projectWrite;
      const projectStart = await queryFixtureSnapshot(state.status, state.fixture);
      const stageEntry = projectStart.stageEntries[0];
      state.stageEntryId = stageEntry?.id ?? null;
      if (
        projectStart.auditEvents.filter((event) => event.action === 'project.create').length !== 1 ||
        projectStart.stageEntries.length !== 1 || stageEntry?.stage !== 'Internal Project' ||
        stageEntry.source !== 'origination' || stageEntry.recorded_by !== state.fixture.userId ||
        projectStart.historyEvents.length !== 2 ||
        !projectStart.historyEvents.some((event) => event.entity_type === 'project' &&
          event.entity_id === state.fixture.projectId && event.op === 'insert' && event.actor_id === state.fixture.userId) ||
        !projectStart.historyEvents.some((event) => event.entity_type === 'project_stage_entry' &&
          event.entity_id === state.stageEntryId && event.op === 'insert' && event.actor_id === state.fixture.userId)
      ) throw safeFailure('S21_PROJECT_CREATE_AUDIT_OR_HISTORY_MISMATCH');
      state.ledger.steps.project = 'verified';
      await saveLedger(state.ledgerPath, state.ledger);

      setJourneyStage('vault-and-org-binding');
      state.vaultSecretSentinel = `S21_SYNTHETIC_${crypto.randomUUID().replaceAll('-', '')}`;
      state.ledger.steps.vaultAndOrgBinding = 'in-flight';
      await saveLedger(state.ledgerPath, state.ledger);
      // The sentinel is a COPY parameter received over stdin and consumed only inside Vault.
      const boundSecretSql = copySql([
        state.fixture.orgId,
        state.fixture.userId,
        state.fixture.projectId,
        state.fixture.orgBindingId,
        '',
        state.fixture.email,
        state.fixture.orgName,
        state.fixture.projectCode,
        state.fixture.projectName,
        state.fixture.secretRef,
        state.fixture.listId,
        state.vaultSecretSentinel,
      ], `
        DO $$
        DECLARE p record;
        BEGIN
          SELECT * INTO p FROM s21_values;
          PERFORM vault.create_secret(p.secret_value, p.secret_ref);
        END $$;
        INSERT INTO public.external_org_bindings
          (id, org_id, external_tier, site_url, secret_ref, status, connected_by, connected_at, config)
        SELECT p.org_binding_id, p.org_id, 'clickup', '', p.secret_ref, 'active', p.user_id, now(), '{}'::jsonb
          FROM s21_values p;
        COMMIT;
      `);
      try {
        await runPsql(state.status, `BEGIN;\n${boundSecretSql}`);
      } catch {
        const reconcile = await queryFixtureSnapshot(state.status, state.fixture);
        if (
          reconcile.orgBindingCount !== 1 || reconcile.vaultSecretCount !== 1 ||
          !reconcile.vaultReaderPresent
        ) throw safeFailure('S21_VAULT_BINDING_WRITE_NOT_RECONCILED');
      }
      const orgBindingRead = await queryFixtureSnapshot(state.status, state.fixture);
      if (orgBindingRead.orgBindingCount !== 1 || orgBindingRead.activeClickUpBindingCount !== 1 ||
        orgBindingRead.vaultSecretCount !== 1 || !orgBindingRead.vaultReaderPresent) {
        throw safeFailure('S21_VAULT_BINDING_STATE_MISMATCH');
      }
      state.ledger.steps.vaultAndOrgBinding = 'verified';
      await saveLedger(state.ledgerPath, state.ledger);

      setJourneyStage('handler-and-browser-setup');
      const clickupSentinel = state.vaultSecretSentinel;
      state.handlerServer = await startHandlerServer(state.status, state.fixture, clickupSentinel);
      if (!appBaseUrl) throw safeFailure('S21_APP_BASE_URL_UNAVAILABLE');
      state.appOrigin = new URL(appBaseUrl).origin;
      await saveLedger(state.ledgerPath, state.ledger);
    } catch (error) {
      state.primaryFailure = error;
      recordS21PrimaryFailure(state.ledger, error, {
        stage: state.journeyStage,
        secretValues: [state.status.DB_URL, state.serviceKey, state.anonKey, state.ephemeralPassword, state.vaultSecretSentinel]
          .filter((value) => typeof value === 'string' && value.length > 0),
        includeDetails: false,
      });
      try {
        await saveLedger(state.ledgerPath, state.ledger);
      } catch {
        // Preserve the fixture/setup failure when private evidence storage is unavailable.
      }
      throw error;
    }
  }

  async function installPageGuard(page) {
    setJourneyStage('browser-route-guard');
    if (!state.handlerServer) throw safeFailure('S21_HANDLER_SERVER_UNAVAILABLE');
    const routeGuard = await installBrowserRouteGuard(
      page,
      state.apiOrigin,
      state.appOrigin,
      state.handlerServer,
      state.ledger,
      (next) => saveLedger(state.ledgerPath, next),
    );
    state.browserRouteGuards.push(routeGuard);
    return routeGuard;
  }

  function beginReloadDiagnostic(page) {
    const diagnostic = createS21ReloadDiagnostic();
    page.on('response', (response) => {
      const category = classifyS21DiagnosticEndpoint(response.url(), state.apiOrigin);
      if (category) diagnostic.recordResponse(category, response.status());
    });
    page.on('requestfailed', (request) => {
      const category = classifyS21DiagnosticEndpoint(request.url(), state.apiOrigin);
      if (category) diagnostic.recordFailure(category);
    });
    state.reloadDiagnostic = diagnostic;
  }

  async function recordJourneyFailure(page, error) {
    const secretValues = [
      state.status.DB_URL,
      state.serviceKey,
      state.anonKey,
      state.ephemeralPassword,
      state.vaultSecretSentinel,
      state.actorAccessToken,
      state.actorRefreshToken,
    ].filter((value) => typeof value === 'string' && value.length > 0);
    recordS21PrimaryFailure(state.ledger, error, {
      stage: state.journeyStage,
      secretValues,
      includeDetails: state.browserAdminLoginConfirmed,
    });
    state.primaryFailure = error;
    if (state.browserAdminLoginConfirmed && page) {
      try {
        const reloadFailure = state.journeyStage === 'reload-linked-task-route' || state.journeyStage.startsWith('reloaded-');
        if (reloadFailure && state.reloadDiagnostic) {
          try {
            state.ledger.reloadDiagnostic = state.reloadDiagnostic.snapshot(await captureS21ReloadDom(page, state.fixture));
          } catch {
            state.ledger.reloadDiagnostic = state.reloadDiagnostic.snapshot();
          }
        }
        await page.screenshot({ path: state.evidence.failureScreenshotPath, animations: 'disabled', fullPage: reloadFailure });
        await chmod(state.evidence.failureScreenshotPath, 0o600);
        state.ledger.failureScreenshot = path.basename(state.evidence.failureScreenshotPath);
      } catch {
        state.ledger.failureScreenshot = 'unavailable';
      }
    }
    state.ledger.journeyStage = 'cleanup';
    try {
      await saveLedger(state.ledgerPath, state.ledger);
    } catch {
      // The original journey failure remains authoritative if diagnostics cannot be saved.
    }
  }

  async function stopOwnedHandler(server) {
    const failureStart = state.cleanupFailureErrors.length;
    try {
      state.ledger.transportSummary = await stopHandlerServer(server);
    } catch {
      markCleanupFailure('handler-stop');
    }
    let browserGuardSummary = null;
    {
      try {
        const measured = validateS21TransportSummary(state.ledger.transportSummary, { requireLink: state.primaryFailure === null });
        browserGuardSummary = state.browserRouteGuards.length > 0
          ? aggregateS21BrowserGuardSnapshots(state.browserRouteGuards.map((guard) => ({
            snapshot: guard.snapshot(),
            blocked: guard.blocked,
          })))
          : null;
        const browserStatusTotal = Object.values(state.ledger.handlerResponseStatusCounts).reduce((sum, count) => sum + count, 0);
        const browserStatusesSuccessful = Object.keys(state.ledger.handlerResponseStatusCounts).every((status) => /^2\d\d$/.test(status));
        if (!browserGuardSummary || browserGuardSummary.handlerPosts !== measured.handlerPosts ||
            browserStatusTotal !== measured.handlerPosts || !browserStatusesSuccessful) {
          throw safeFailure('S21_HANDLER_COUNT_MISMATCH');
        }
      } catch {
        markCleanupFailure('transport-summary');
      }
    }
    if (browserGuardSummary) {
      state.ledger.browserBlockedByReason = { ...browserGuardSummary.blocked };
      if (browserGuardSummary.clickupOnboardRequests !== 0) markCleanupFailure('operator-initializer');
      if (Object.keys(browserGuardSummary.blocked).length > 0) markCleanupFailure('browser-outbound');
    }
    try {
      await saveLedger(state.ledgerPath, state.ledger);
    } catch {
      markCleanupFailure('write-ahead-ledger');
    }

    if (state.cleanupFailureErrors.length > failureStart) {
      throw new AggregateError(state.cleanupFailureErrors.slice(failureStart), 'S21 owned handler cleanup failed');
    }
  }

  async function cleanupOwnedRows() {
    const failureStart = state.cleanupFailureErrors.length;
    try {
      if (!state.fixturePreflightPassed) throw safeFailure('S21_COLLISION_PRESERVED');
      const binding = await projectBindingReadback(state.initialAdmin, state.fixture);
      if (binding) {
        if (binding.external_container_id !== state.fixture.listId || binding.linked_by !== state.fixture.userId) {
          throw safeFailure('S21_PROJECT_BINDING_UNOWNED');
        }
        state.ledger.ownedIds.projectBindingId = binding.id;
        state.bindingCreated = true;
        state.ledger.steps.cleanup = 'project-binding-delete-in-flight';
        await saveLedger(state.ledgerPath, state.ledger);
        const { error } = await state.initialAdmin.from('external_project_bindings').delete()
          .eq('id', binding.id).eq('org_id', state.fixture.orgId).eq('project_id', state.fixture.projectId)
          .eq('external_tier', 'clickup');
        const after = await projectBindingReadback(state.initialAdmin, state.fixture);
        if (after) throw safeFailure(error ? 'S21_PROJECT_BINDING_DELETE_UNRESOLVED' : 'S21_PROJECT_BINDING_DELETE_FAILED');
        state.ledger.steps.projectBinding = 'removed';
        await saveLedger(state.ledgerPath, state.ledger);
      }
    } catch {
      markCleanupFailure('project-binding');
    }

    try {
      if (!state.fixturePreflightPassed) throw safeFailure('S21_COLLISION_PRESERVED');
      const project = await assertSingleRow(
        state.initialAdmin.from('projects').select('id, org_id, code, name').eq('id', state.fixture.projectId).eq('org_id', state.fixture.orgId),
        'S21_PROJECT_CLEANUP_READ_FAILED',
      );
      if (project) {
        if (project.code !== state.fixture.projectCode || project.name !== state.fixture.projectName) throw safeFailure('S21_PROJECT_UNOWNED');
        state.ledger.steps.cleanup = 'project-delete-in-flight';
        await saveLedger(state.ledgerPath, state.ledger);
        if (!state.actorAuthenticated) throw safeFailure('S21_PROJECT_DELETE_ACTOR_UNAVAILABLE');
        await state.actorClient.from('projects').delete().eq('id', state.fixture.projectId).eq('org_id', state.fixture.orgId);
        const after = await assertSingleRow(
          state.initialAdmin.from('projects').select('id').eq('id', state.fixture.projectId).eq('org_id', state.fixture.orgId),
          'S21_PROJECT_CLEANUP_RECONCILE_FAILED',
        );
        if (after) throw safeFailure('S21_PROJECT_DELETE_UNRESOLVED');
        state.projectDeleted = true;
        state.ledger.steps.project = 'removed';
        await saveLedger(state.ledgerPath, state.ledger);
      }
    } catch {
      markCleanupFailure('project');
    }

    try {
      if (!state.fixturePreflightPassed) throw safeFailure('S21_COLLISION_PRESERVED');
      const { data: authRead, error: authReadError } = await state.initialAdmin.auth.admin.getUserById(state.fixture.userId);
      if (authReadError && authReadError.status !== 404) throw safeFailure('S21_AUTH_CLEANUP_READ_FAILED');
      if (authRead.user) {
        if (authRead.user.email !== state.fixture.email) throw safeFailure('S21_AUTH_USER_UNOWNED');
        state.ledger.steps.cleanup = 'auth-user-delete-in-flight';
        await saveLedger(state.ledgerPath, state.ledger);
        await state.initialAdmin.auth.admin.deleteUser(state.fixture.userId);
        const { data: after } = await state.initialAdmin.auth.admin.getUserById(state.fixture.userId);
        if (after.user) throw safeFailure('S21_AUTH_USER_DELETE_UNRESOLVED');
      }
      const profile = await assertSingleRow(
        state.initialAdmin.from('profiles').select('id').eq('id', state.fixture.userId).eq('org_id', state.fixture.orgId),
        'S21_PROFILE_CLEANUP_READ_FAILED',
      );
      if (profile) throw safeFailure('S21_PROFILE_CASCADE_NOT_VERIFIED');
      state.ledger.steps.authUser = 'removed';
      state.ledger.steps.profile = 'removed';
      await saveLedger(state.ledgerPath, state.ledger);
    } catch {
      markCleanupFailure('auth-profile');
    }

    try {
      if (!state.fixturePreflightPassed) throw safeFailure('S21_COLLISION_PRESERVED');
      const snapshot = await queryFixtureSnapshot(state.status, state.fixture);
      if (snapshot.orgBindingCount === 1 && snapshot.vaultSecretCount === 1 && snapshot.vaultReaderPresent) {
        state.ledger.steps.cleanup = 'vault-binding-delete-in-flight';
        await saveLedger(state.ledgerPath, state.ledger);
        await removeVaultAndOrgBinding(state.status, state.fixture);
      } else if (snapshot.orgBindingCount !== 0 || snapshot.vaultSecretCount !== 0 || snapshot.vaultReaderPresent) {
        throw safeFailure('S21_VAULT_BINDING_PARTIAL_STATE');
      }
      const after = await queryFixtureSnapshot(state.status, state.fixture);
      if (after.orgBindingCount !== 0 || after.vaultSecretCount !== 0 || after.vaultReaderPresent) {
        throw safeFailure('S21_VAULT_BINDING_DELETE_UNRESOLVED');
      }
      state.ledger.steps.vaultAndOrgBinding = 'removed';
      await saveLedger(state.ledgerPath, state.ledger);
    } catch {
      markCleanupFailure('vault-org-binding');
    }

    if (!state.cleanupFailed && state.fixturePreflightPassed) {
      try {
        await assertFinalFixtureState(
          state.status,
          state.fixture,
          state.ledger,
          state.projectCreated,
          state.bindingCreated,
          state.projectDeleted,
          state.stageEntryId,
        );
        await saveLedger(state.ledgerPath, state.ledger);
      } catch {
        markCleanupFailure('final-retention-proof');
      }
    }
    await state.actorClient.auth.signOut({ scope: 'local' }).catch(() => undefined);
    if (state.cleanupFailureErrors.length > failureStart) {
      throw new AggregateError(state.cleanupFailureErrors.slice(failureStart), 'S21 owned fixture row cleanup failed');
    }
  }

  const harness = {
    get fixture() {
      return state.fixture;
    },
    get ledger() {
      return state.ledger;
    },
    get ledgerPath() {
      return state.ledgerPath;
    },
    get initialAdmin() {
      return state.initialAdmin;
    },
    get handlerServer() {
      return state.handlerServer;
    },
    get ephemeralPassword() {
      return state.ephemeralPassword;
    },
    get apiOrigin() {
      return state.apiOrigin;
    },
    get appOrigin() {
      return state.appOrigin;
    },
    initRun,
    setup,
    installPageGuard,
    readback: (db, fixture) => projectBindingReadback(db, fixture),
    beginReloadDiagnostic,
    recordJourneyFailure,
    setJourneyStage,
    markBrowserLoginConfirmed(confirmed) {
      state.browserAdminLoginConfirmed = confirmed;
    },
    markBindingCreated() {
      state.bindingCreated = true;
    },
    stopOwnedHandler,
    cleanupOwnedRows,
    persistLedger: (pathname, book) => saveLedger(pathname, book),
    dispose(deps = {}) {
      const runCleanup = deps.runCleanup ?? runS21FixtureCleanup;
      if (!state.ledger) return Promise.resolve();
      return runCleanup({
        preflightPassed: state.fixturePreflightPassed,
        ownedServer: state.handlerServer,
        primaryFailure: state.primaryFailure,
        stopOwnedServer: (server) => stopOwnedHandler(server),
        cleanupOwnedRows: () => cleanupOwnedRows(),
      });
    },
  };
  return harness;
}
