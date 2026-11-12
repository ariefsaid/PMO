/** The capture endpoint accepts neutral source scopes and reviewed revision identities. */
export async function captureHistory(api, { projectId = null, dryRun, revision, requestId }) {
  if (!dryRun && (!revision || !requestId)) throw new Error('Apply requires the preview revision and request identity.');
  const payload = { action: dryRun ? 'preview' : 'apply', scope: { projectId } };
  if (!dryRun) Object.assign(payload, { expectedRevision: revision, requestId });
  return api.capture(payload);
}
