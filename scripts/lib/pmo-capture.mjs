/** Use the same scope and review identity when accepting a census. */
export async function captureHistory(api, { projectId = null, dryRun, revision, requestId }) {
  if (!dryRun && (!revision || !requestId)) {
    throw new Error('Apply requires the preview revision and request identity.');
  }
  const payload = { action: dryRun ? 'preview' : 'apply', scope: { projectId } };
  if (!dryRun) Object.assign(payload, { expectedRevision: revision, requestId });
  return api.capture(payload);
}

/** Preserve the work error if cleanup also fails, while still exposing the cleanup error. */
export async function withCaptureProofCleanup(work, cleanup) {
  let result;
  try {
    result = await work();
  } catch (primary) {
    try { await cleanup(); }
    catch (cleanupError) { throw new AggregateError([primary, cleanupError], 'Capture proof and cleanup both failed', { cause: primary }); }
    throw primary;
  }
  await cleanup();
  return result;
}
