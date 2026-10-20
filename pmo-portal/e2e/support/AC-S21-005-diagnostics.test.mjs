import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyS21DiagnosticEndpoint,
  createS21ReloadDiagnostic,
} from './AC-S21-005-diagnostics.mjs';

const apiOrigin = 'http://127.0.0.1:54321';

test('reload diagnostics classify only allowlisted local endpoint categories', () => {
  assert.equal(
    classifyS21DiagnosticEndpoint(`${apiOrigin}/rest/v1/external_project_bindings?select=*&access_token=private`, apiOrigin),
    'rest-project-bindings',
  );
  assert.equal(classifyS21DiagnosticEndpoint(`${apiOrigin}/rest/v1/projects`, apiOrigin), 'rest-project');
  assert.equal(classifyS21DiagnosticEndpoint(`${apiOrigin}/rest/v1/external_org_bindings`, apiOrigin), 'rest-org-bindings');
  assert.equal(classifyS21DiagnosticEndpoint(`${apiOrigin}/rest/v1/tasks`, apiOrigin), 'rest-tasks');
  assert.equal(classifyS21DiagnosticEndpoint(`${apiOrigin}/auth/v1/user`, apiOrigin), 'auth-user');
  assert.equal(classifyS21DiagnosticEndpoint(`${apiOrigin}/functions/v1/external-lists`, apiOrigin), 'function-external-lists');
  assert.equal(classifyS21DiagnosticEndpoint('https://outside.invalid/rest/v1/projects', apiOrigin), null);
  assert.equal(classifyS21DiagnosticEndpoint(`${apiOrigin}/rest/v1/private-table`, apiOrigin), null);
  assert.equal(classifyS21DiagnosticEndpoint('not a URL', apiOrigin), null);
});

test('reload diagnostic snapshots retain only bounded endpoint status and allowlisted DOM booleans', () => {
  const diagnostic = createS21ReloadDiagnostic();
  diagnostic.recordResponse('rest-project-bindings', 200);
  diagnostic.recordResponse('rest-project-bindings', 503);
  diagnostic.recordFailure('rest-project');
  diagnostic.recordResponse('unrecognized-endpoint', 200);
  diagnostic.recordResponse('auth-user', 700);

  const secret = 'private-token-and-synthetic-fixture-value';
  const snapshot = diagnostic.snapshot({
    compactCardPresent: true,
    bindingLoadingVisible: false,
    bindingErrorVisible: true,
    listDetailsLoadingVisible: false,
    savedListIdentityVisible: false,
    token: secret,
    responseBody: secret,
    rawUrl: `${apiOrigin}/rest/v1/profiles?token=${secret}`,
    rawError: secret,
  });

  assert.deepEqual(snapshot, {
    dom: {
      tasksHeadingVisible: false,
      emptyTaskStateVisible: false,
      bindingLoadingVisible: false,
      compactCardPresent: true,
      compactCardUnique: false,
      clickupTierCardPresent: false,
      bindingErrorVisible: true,
      listErrorVisible: false,
      listDetailsLoadingVisible: false,
      savedListIdentityVisible: false,
    },
    endpoints: [
      { category: 'rest-project-bindings', status: 200, failed: false },
      { category: 'rest-project-bindings', status: 503, failed: false },
      { category: 'rest-project', status: null, failed: true },
    ],
  });
  assert.equal(JSON.stringify(snapshot).includes(secret), false);
  assert.equal(JSON.stringify(snapshot).includes('private-table'), false);
});

test('reload diagnostics cap event volume and discard malformed DOM values', () => {
  const diagnostic = createS21ReloadDiagnostic();
  for (let index = 0; index < 100; index += 1) diagnostic.recordResponse('rest-project', 200);
  const snapshot = diagnostic.snapshot({
    compactCardPresent: 'true',
    bindingLoadingVisible: true,
    savedListIdentityVisible: 1,
  });

  assert.equal(snapshot.endpoints.length, 48);
  assert.equal(snapshot.dom.compactCardPresent, false);
  assert.equal(snapshot.dom.bindingLoadingVisible, true);
  assert.equal(snapshot.dom.savedListIdentityVisible, false);
});
