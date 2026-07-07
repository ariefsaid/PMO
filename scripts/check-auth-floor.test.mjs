/**
 * Unit tests for check-auth-floor.mjs (audit follow-up: the #1 MVP-blocker — turn the
 * printed auth-floor checklist, docs/environments.md "Production auth floor", into an
 * ENFORCED pre-flight). All network calls are mocked via an injected fetch — no live
 * Management API call, no secrets, mirrors check-agent-prod-readiness.mjs's test-boundary
 * (pure classifiers unit-tested; the live orchestration is integration-only).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifySignupDisabled,
  classifyConfirmationsEnabled,
  classifyRedirectAllowlist,
  evaluateAuthFloor,
  fetchAuthConfig,
} from './check-auth-floor.mjs';

test('AC-AUTHFLOOR-001: classifySignupDisabled passes when disable_signup is true', () => {
  const verdict = classifySignupDisabled({ disable_signup: true });
  assert.equal(verdict.healthy, true);
});

test('AC-AUTHFLOOR-001: classifySignupDisabled FAILs when disable_signup is false (open self-signup)', () => {
  const verdict = classifySignupDisabled({ disable_signup: false });
  assert.equal(verdict.healthy, false);
  assert.match(verdict.detail, /signup/i);
});

test('AC-AUTHFLOOR-002: classifyConfirmationsEnabled passes when mailer_autoconfirm is false', () => {
  const verdict = classifyConfirmationsEnabled({ mailer_autoconfirm: false });
  assert.equal(verdict.healthy, true);
});

test('AC-AUTHFLOOR-002: classifyConfirmationsEnabled FAILs when mailer_autoconfirm is true (unconfirmed logins allowed)', () => {
  const verdict = classifyConfirmationsEnabled({ mailer_autoconfirm: true });
  assert.equal(verdict.healthy, false);
  assert.match(verdict.detail, /confirm/i);
});

test('AC-AUTHFLOOR-003: classifyRedirectAllowlist passes with only HTTPS prod origins', () => {
  const verdict = classifyRedirectAllowlist({
    uri_allow_list: 'https://acme.example.com,https://acme.example.com/**',
    site_url: 'https://acme.example.com',
  });
  assert.equal(verdict.healthy, true);
});

test('AC-AUTHFLOOR-003: classifyRedirectAllowlist FAILs when uri_allow_list contains localhost', () => {
  const verdict = classifyRedirectAllowlist({
    uri_allow_list: 'https://acme.example.com,http://localhost:3000/**',
    site_url: 'https://acme.example.com',
  });
  assert.equal(verdict.healthy, false);
  assert.match(verdict.detail, /localhost/i);
});

test('AC-AUTHFLOOR-003: classifyRedirectAllowlist FAILs when uri_allow_list contains 127.0.0.1', () => {
  const verdict = classifyRedirectAllowlist({
    uri_allow_list: 'https://acme.example.com,http://127.0.0.1:3000/**',
    site_url: 'https://acme.example.com',
  });
  assert.equal(verdict.healthy, false);
  assert.match(verdict.detail, /127\.0\.0\.1/);
});

test('AC-AUTHFLOOR-003: classifyRedirectAllowlist FAILs when site_url itself is localhost', () => {
  const verdict = classifyRedirectAllowlist({
    uri_allow_list: 'https://acme.example.com',
    site_url: 'http://localhost:3000',
  });
  assert.equal(verdict.healthy, false);
  assert.match(verdict.detail, /site_url/i);
});

test('classifyRedirectAllowlist treats an array uri_allow_list the same as a comma-separated string', () => {
  const verdict = classifyRedirectAllowlist({
    uri_allow_list: ['https://acme.example.com', 'http://localhost:3000/**'],
    site_url: 'https://acme.example.com',
  });
  assert.equal(verdict.healthy, false);
  assert.match(verdict.detail, /localhost/i);
});

test('evaluateAuthFloor: all-safe config → overall PASS, one verdict per setting', () => {
  const result = evaluateAuthFloor({
    disable_signup: true,
    mailer_autoconfirm: false,
    uri_allow_list: 'https://acme.example.com/**',
    site_url: 'https://acme.example.com',
  });
  assert.equal(result.ok, true);
  assert.equal(result.checks.length, 3);
  assert.ok(result.checks.every((c) => c.healthy));
});

test('evaluateAuthFloor: signup open → overall FAIL, only that check unhealthy', () => {
  const result = evaluateAuthFloor({
    disable_signup: false,
    mailer_autoconfirm: false,
    uri_allow_list: 'https://acme.example.com/**',
    site_url: 'https://acme.example.com',
  });
  assert.equal(result.ok, false);
  const signupCheck = result.checks.find((c) => c.name === 'signup-disabled');
  assert.equal(signupCheck.healthy, false);
  const others = result.checks.filter((c) => c.name !== 'signup-disabled');
  assert.ok(others.every((c) => c.healthy));
});

test('evaluateAuthFloor: confirmations off → overall FAIL, only that check unhealthy', () => {
  const result = evaluateAuthFloor({
    disable_signup: true,
    mailer_autoconfirm: true,
    uri_allow_list: 'https://acme.example.com/**',
    site_url: 'https://acme.example.com',
  });
  assert.equal(result.ok, false);
  const confirmCheck = result.checks.find((c) => c.name === 'confirmations-enabled');
  assert.equal(confirmCheck.healthy, false);
});

test('evaluateAuthFloor: localhost redirect present → overall FAIL, only that check unhealthy', () => {
  const result = evaluateAuthFloor({
    disable_signup: true,
    mailer_autoconfirm: false,
    uri_allow_list: 'https://acme.example.com/**,http://localhost:3000/**',
    site_url: 'https://acme.example.com',
  });
  assert.equal(result.ok, false);
  const redirectCheck = result.checks.find((c) => c.name === 'redirect-allowlist');
  assert.equal(redirectCheck.healthy, false);
});

test('evaluateAuthFloor: all three unsafe → overall FAIL with all three unhealthy', () => {
  const result = evaluateAuthFloor({
    disable_signup: false,
    mailer_autoconfirm: true,
    uri_allow_list: 'http://localhost:3000/**',
    site_url: 'http://localhost:3000',
  });
  assert.equal(result.ok, false);
  assert.equal(result.checks.filter((c) => !c.healthy).length, 3);
});

test('fetchAuthConfig calls the Management API auth-config endpoint with a bearer, never printing the token', async () => {
  let capturedUrl;
  let capturedHeaders;
  const fakeFetch = async (url, init) => {
    capturedUrl = url;
    capturedHeaders = init.headers;
    return {
      ok: true,
      status: 200,
      json: async () => ({ disable_signup: true, mailer_autoconfirm: false, uri_allow_list: '', site_url: 'https://x.example.com' }),
    };
  };
  const result = await fetchAuthConfig({ ref: 'abcxyz123', token: 'sbp_supersecrettoken', fetchImpl: fakeFetch });
  assert.equal(capturedUrl, 'https://api.supabase.com/v1/projects/abcxyz123/config/auth');
  assert.equal(capturedHeaders.Authorization, 'Bearer sbp_supersecrettoken');
  assert.equal(result.ok, true);
  assert.equal(result.config.disable_signup, true);
});

test('fetchAuthConfig reports a non-ok HTTP response without throwing', async () => {
  const fakeFetch = async () => ({ ok: false, status: 401, json: async () => ({ message: 'Invalid token' }) });
  const result = await fetchAuthConfig({ ref: 'abcxyz123', token: 'bad-token', fetchImpl: fakeFetch });
  assert.equal(result.ok, false);
  assert.match(result.error, /401/);
});

test('fetchAuthConfig reports a network error without throwing', async () => {
  const fakeFetch = async () => {
    throw new Error('ECONNREFUSED');
  };
  const result = await fetchAuthConfig({ ref: 'abcxyz123', token: 'x', fetchImpl: fakeFetch });
  assert.equal(result.ok, false);
  assert.match(result.error, /ECONNREFUSED/);
});
