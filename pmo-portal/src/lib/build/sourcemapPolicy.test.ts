import { describe, it, expect } from 'vitest';
import { isDeployBuild, planSourcemapUpload } from '../../../../scripts/sourcemapPolicy.mjs';

const deploy = { CF_PAGES: '1', CF_PAGES_BRANCH: 'production' };
const CRED = { POSTHOG_CLI_API_KEY: 'k', POSTHOG_CLI_PROJECT_ID: '1' };

describe('AC-PHO-011 source-map policy', () => {
  it('only a Cloudflare production build is a deploy build', () => {
    expect(isDeployBuild(deploy)).toBe(true);
    expect(isDeployBuild({})).toBe(false);
    expect(isDeployBuild({ CF_PAGES: '1', CF_PAGES_BRANCH: 'dev' })).toBe(false);
  });
  it('deploy build without the upload credential is planned as fail (the step downgrades it to a warning)', () => {
    expect(planSourcemapUpload(deploy, ['a.js.map'])).toMatchObject({ action: 'fail' });
    expect(planSourcemapUpload({ ...deploy, POSTHOG_CLI_API_KEY: 'k' }, ['a.js.map'])).toMatchObject({ action: 'fail' });
  });
  it('non-deploy build SKIPS visibly, never fails', () => {
    expect(planSourcemapUpload({}, [])).toEqual({ action: 'skip', reason: expect.stringContaining('not a deploy build') });
  });
  it('deploy build with credential but no maps is planned as fail', () => {
    expect(planSourcemapUpload({ ...deploy, ...CRED }, [])).toMatchObject({ action: 'fail' });
  });
  it('deploy build with credential and maps UPLOADS', () => {
    expect(planSourcemapUpload({ ...deploy, ...CRED }, ['a.js.map'])).toMatchObject({ action: 'upload' });
  });
});
