// @e2e-isolation: self-isolated — this journey owns one fresh test organization and exact run-scoped rows.
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type {
  captureS21FailureDiagnostic,
  createS21FixtureIdentity,
  createS21WriteAheadLedger,
} from './support/AC-S21-005-fixture.mjs';
import { S21_MAX_HANDLER_POSTS } from './support/AC-S21-005-transport.mjs';
import { S21_FIXTURE_PHASE_TIMEOUT_MS } from './support/AC-S21-005-lifecycle.mjs';
import { createS21JourneyHarness } from './support/AC-S21-005-harness.mjs';
import { ownedContextOptions } from './helpers';

type Fixture = ReturnType<typeof createS21FixtureIdentity>;
type FixtureLedger = ReturnType<typeof createS21WriteAheadLedger>;
type BrowserGuardSnapshot = { handlerPosts: number; clickupOnboardRequests: number };
type Ledger = Omit<FixtureLedger, 'ownedIds' | 'steps'> & {
  ownedIds: Omit<FixtureLedger['ownedIds'], 'projectBindingId' | 'auditEventIds' | 'historyEventIds'> & {
    projectBindingId: string | null;
    auditEventIds: string[];
    historyEventIds: string[];
  };
  steps: Record<string, string>;
  requestCaps: { clickupGets: number; handlerPosts: number };
  handlerResponseStatusCounts: Record<string, number>;
  browserBlockedByReason: Record<string, number>;
  transportSummary: unknown;
  journeyStage: string | null;
  failedJourneyStage: string | null;
  primaryFailureDiagnostic: ReturnType<typeof captureS21FailureDiagnostic> | null;
  reloadDiagnostic: {
    dom: Record<string, boolean>;
    endpoints: { category: string; status: number | null; failed: boolean }[];
  } | null;
  failureScreenshot: string | null;
  primaryFailure: string | null;
  cleanupFailureSteps: string[];
};

let harness: ReturnType<typeof createS21JourneyHarness>;
let fixture: Fixture;
let ledger: Ledger;
let ledgerPath: string;
let initialAdmin: SupabaseClient;
let pageRouteSnapshot: (() => BrowserGuardSnapshot) | null = null;
let browserBlocked: Record<string, number> = {};
let handlerServer: HandlerServer | null = null;
let continuationContext: BrowserContext | null = null;
let continuationPage: Page | null = null;
let continuationBindingId: string | null = null;
let ephemeralPassword: string | null = null;

function setJourneyStage(stage: string): void {
  harness.setJourneyStage(stage);
}

function safeFailure(code: string): Error {
  return new Error(code);
}

async function saveLedger(pathname: string, book: Ledger): Promise<void> {
  await harness.persistLedger(pathname, book);
}

type HandlerServer = {
  child: ChildProcessWithoutNullStreams;
  origin: string;
  waitUntilReady: Promise<void>;
  summary: () => unknown;
};

async function projectBindingReadback(db: SupabaseClient, fixture: Fixture) {
  return harness.readback(db, fixture);
}

test.beforeAll(async ({ playwright: _playwright }, testInfo) => {
  test.setTimeout(S21_FIXTURE_PHASE_TIMEOUT_MS);
  harness = createS21JourneyHarness();
  await harness.setup({ appBaseUrl: testInfo.project.use.baseURL });
  fixture = harness.fixture!;
  ledger = harness.ledger as unknown as Ledger;
  ledgerPath = harness.ledgerPath!;
  initialAdmin = harness.initialAdmin!;
  handlerServer = harness.handlerServer as HandlerServer;
  ephemeralPassword = harness.ephemeralPassword;
});

async function installBrowserRouteGuardForPage(page: Page): Promise<void> {
  const routeGuard = await harness.installPageGuard(page);
  pageRouteSnapshot = routeGuard.snapshot;
  browserBlocked = routeGuard.blocked;
}

async function adminLoginAndOpenTaskRoute(page: Page): Promise<Locator> {
  harness.markBrowserLoginConfirmed(false);
  setJourneyStage('admin-login-page-load');
  await page.goto('/login');
  setJourneyStage('admin-login-email-entry');
  await page.getByLabel(/email/i).fill(fixture.email);
  setJourneyStage('admin-login-password-entry');
  if (!ephemeralPassword) throw safeFailure('S21_FIXTURE_PASSWORD_UNAVAILABLE');
  await page.getByLabel(/password/i).fill(ephemeralPassword);
  setJourneyStage('admin-login-submit');
  await page.getByRole('button', { name: /sign in/i }).click();
  setJourneyStage('admin-home-after-login');
  await expect(page).toHaveURL(/\/$/);
  harness.markBrowserLoginConfirmed(true);

  setJourneyStage('open-project-task-route');
  await page.goto(`/projects/${fixture.projectId}/tasks`);
  setJourneyStage('tasks-heading-visible');
  await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible();
  setJourneyStage('empty-task-state-visible');
  await expect(page.getByText('No tasks yet', { exact: true })).toBeVisible();
  return page.getByTestId('project-integrations-compact');
}

async function recordS21BrowserFailure(page: Page | null, error: unknown): Promise<void> {
  await harness.recordJourneyFailure(page, error);
}

test.describe.serial('S21 complete ordered task-link journey', () => {
  test('Supporting proof: Admin reviews the ClickUp list, saves the source, and reads back the binding', async ({ page }) => {
    test.setTimeout(S21_FIXTURE_PHASE_TIMEOUT_MS);
    try {
      const activeHandlerServer = handlerServer;
      if (!activeHandlerServer) throw safeFailure('S21_HANDLER_SERVER_UNAVAILABLE');
      await installBrowserRouteGuardForPage(page);
      const integrationCard = await adminLoginAndOpenTaskRoute(page);
      setJourneyStage('clickup-link-action-visible');
      await expect(integrationCard.getByRole('button', { name: 'Link to ClickUp' })).toBeVisible();
      setJourneyStage('open-clickup-link-picker');
      await integrationCard.getByRole('button', { name: 'Link to ClickUp' }).click();

      setJourneyStage('clickup-list-picker-opens');
      const listPicker = page.getByRole('combobox', { name: 'ClickUp List' });
      await listPicker.click();
      setJourneyStage('exact-existing-list-option-selectable');
      await page.getByRole('option', { name: new RegExp(fixture.listName) }).click();
      setJourneyStage('initial-transfer-direction-selected');
      await page.getByRole('radio', { name: /Start with PMO tasks/ }).check();
      setJourneyStage('review-link-action');
      await page.getByRole('button', { name: 'Review link' }).click();
      const reviewDialog = page.getByRole('dialog', { name: 'Review ClickUp link' });
      const reviewProjectField = reviewDialog.getByText('PMO project', { exact: true }).locator('..');
      const reviewListField = reviewDialog.getByText('ClickUp List', { exact: true }).locator('..');
      setJourneyStage('review-project-name-visible');
      await expect(reviewDialog).toBeVisible();
      await expect(reviewProjectField.getByText(fixture.projectName, { exact: true })).toBeVisible();
      setJourneyStage('review-list-name-visible');
      await expect(reviewListField.getByText(fixture.listName, { exact: true })).toBeVisible();
      setJourneyStage('review-transfer-direction-visible');
      await expect(reviewDialog.getByText(/Start with PMO tasks/).last()).toBeVisible();
      setJourneyStage('review-transfer-notice-visible');
      await expect(reviewDialog.getByText(/This choice describes the initial task transfer only/)).toBeVisible();
      setJourneyStage('review-no-transfer-completion-claim');
      await expect(reviewDialog.getByText(/Saving this link does not confirm that the initial task transfer has completed/)).toBeVisible();

      setJourneyStage('confirm-project-link-action');
      await page.getByRole('button', { name: 'Confirm ClickUp link' }).click();
      setJourneyStage('link-success-visible');
      await expect(page.getByText(/Linked to ClickUp list/)).toBeVisible();
      setJourneyStage('initial-project-binding-readback');
      const firstBinding = await projectBindingReadback(initialAdmin, fixture);
      if (!firstBinding || firstBinding.external_container_id !== fixture.listId ||
        firstBinding.config?.direction !== 'push-seed' || firstBinding.linked_by !== fixture.userId) {
        throw safeFailure('S21_PROJECT_BINDING_PERSISTENCE_MISMATCH');
      }
      ledger.ownedIds.projectBindingId = firstBinding.id;
      harness.markBindingCreated();
      ledger.steps.projectBinding = 'verified';
      const browserSnapshot = pageRouteSnapshot?.();
      if (!browserSnapshot || browserSnapshot.clickupOnboardRequests !== 0 || browserSnapshot.handlerPosts > S21_MAX_HANDLER_POSTS) {
        throw safeFailure('S21_BROWSER_REQUEST_POLICY_VIOLATION');
      }
      ledger.browserBlockedByReason = { ...browserBlocked };
      if (Object.keys(browserBlocked).length > 0) throw safeFailure('S21_BROWSER_OUTBOUND_BLOCKED');
      ledger.transportSummary = activeHandlerServer.summary();
      await saveLedger(ledgerPath, ledger);
    } catch (error) {
      await recordS21BrowserFailure(page, error);
      throw error;
    }
  });

  test('Supporting proof: Admin opens the linked task route for the reload continuation', async ({ browser }, testInfo) => {
    test.setTimeout(S21_FIXTURE_PHASE_TIMEOUT_MS);
    harness.markBrowserLoginConfirmed(false);
    let page: Page | null = null;
    try {
      const activeHandlerServer = handlerServer;
      if (!activeHandlerServer) throw safeFailure('S21_HANDLER_SERVER_UNAVAILABLE');
      const appBaseUrl = testInfo.project.use.baseURL;
      if (!appBaseUrl) throw safeFailure('S21_APP_BASE_URL_UNAVAILABLE');
      setJourneyStage('reload-support-browser-context');
      const ownedContext = await browser.newContext(ownedContextOptions(testInfo, { baseURL: appBaseUrl }));
      continuationContext = ownedContext;
      page = await ownedContext.newPage();
      continuationPage = page;
      await installBrowserRouteGuardForPage(page);
      await adminLoginAndOpenTaskRoute(page);
      const firstBindingId = ledger.ownedIds.projectBindingId;
      if (!firstBindingId) throw safeFailure('S21_PROJECT_BINDING_PERSISTENCE_MISMATCH');
      continuationBindingId = firstBindingId;
    } catch (error) {
      await recordS21BrowserFailure(page, error);
      throw error;
    }
  });

  test('AC-S21-005: Admin sees the persisted ClickUp link and initial source after reload', async () => {
    test.setTimeout(S21_FIXTURE_PHASE_TIMEOUT_MS);
    const page = continuationPage;
    try {
      if (!page || page.isClosed()) throw safeFailure('S21_RELOAD_CONTINUATION_PAGE_UNAVAILABLE');
      const activeHandlerServer = handlerServer;
      if (!activeHandlerServer) throw safeFailure('S21_HANDLER_SERVER_UNAVAILABLE');
      const integrationCard = page.getByTestId('project-integrations-compact');
      const firstBindingId = continuationBindingId;
      if (!firstBindingId) throw safeFailure('S21_PROJECT_BINDING_PERSISTENCE_MISMATCH');

      setJourneyStage('reload-linked-task-route');
      harness.beginReloadDiagnostic(page);
      await page.reload();
      setJourneyStage('reloaded-list-name-visible');
      // SUB-F: the one-line link names the list; the initial source (push-seed) is proven by the DB readback below.
      const reloadedListField = integrationCard.getByText(`Linked to ClickUp list ${fixture.listName}`);
      await expect(reloadedListField).toHaveCount(1);
      await expect(reloadedListField).toBeVisible();
      setJourneyStage('reloaded-link-success-visible');
      await expect(integrationCard.getByRole('button', { name: 'Unlink from ClickUp' })).toBeVisible();
      setJourneyStage('reloaded-empty-task-state-visible');
      await expect(page.getByText('No tasks yet', { exact: true })).toBeVisible();
      setJourneyStage('persisted-project-binding-readback');
      const secondBinding = await projectBindingReadback(initialAdmin, fixture);
      setJourneyStage('persisted-project-binding-fields-match');
      expect(secondBinding).toMatchObject({
        id: firstBindingId,
        org_id: fixture.orgId,
        project_id: fixture.projectId,
        external_tier: 'clickup',
        external_container_id: fixture.listId,
        config: { direction: 'push-seed' },
        linked_by: fixture.userId,
      });
      setJourneyStage('task-set-remains-unchanged');
      const { count: taskCount, error: taskCountError } = await initialAdmin
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', fixture.orgId)
        .eq('project_id', fixture.projectId);
      if (taskCountError || taskCount !== 0) throw safeFailure('S21_TASK_SET_CHANGED');

      const browserSnapshot = pageRouteSnapshot?.();
      if (!browserSnapshot || browserSnapshot.clickupOnboardRequests !== 0 || browserSnapshot.handlerPosts > S21_MAX_HANDLER_POSTS) {
        throw safeFailure('S21_BROWSER_REQUEST_POLICY_VIOLATION');
      }
      ledger.browserBlockedByReason = { ...browserBlocked };
      if (Object.keys(browserBlocked).length > 0) throw safeFailure('S21_BROWSER_OUTBOUND_BLOCKED');
      ledger.steps.projectBinding = 'verified-after-reload';
      ledger.transportSummary = activeHandlerServer.summary();
      await saveLedger(ledgerPath, ledger);
    } catch (error) {
      await recordS21BrowserFailure(page, error);
      throw error;
    }
  });
});

test.afterAll(async () => {
  test.setTimeout(S21_FIXTURE_PHASE_TIMEOUT_MS);
  const ownedContext = continuationContext;
  let cleanupError: unknown = null;
  try {
    if (ledger) {
      await harness.dispose();
    }
  } catch (error) {
    cleanupError = error;
  }
  continuationPage = null;
  continuationBindingId = null;
  continuationContext = null;
  try {
    await ownedContext?.close();
  } catch (contextError) {
    if (cleanupError) {
      throw new AggregateError([cleanupError, contextError], 'S21 fixture and continuation context cleanup failed', { cause: contextError });
    }
    throw contextError;
  }
  if (cleanupError) throw cleanupError;
});
