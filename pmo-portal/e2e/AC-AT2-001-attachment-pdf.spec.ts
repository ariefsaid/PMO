/**
 * AC-AT2-001 - User attaches a PDF and asks about it.
 *
 * Proves FR-AT2-ATT-001/007/008/009: the user can attach a PDF via the composer,
 * the upload flow succeeds (prepareUpload → signed PUT → confirmUpload), and the
 * agent-chat POST body carries `attachmentIds` (references only, never raw bytes).
 *
 * The live model is not exercised here. All backend routes are intercepted and
 * fulfilled with deterministic responses — this runs in CI-integration without
 * the model or Storage backend.
 */
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

test.setTimeout(120_000);

function buildSseBody(payloads: unknown[]): string {
  return payloads.map((p) => `data: ${JSON.stringify(p)}\n\n`).join('');
}

const RUN_ID = 'e2e-at2-001-run-001';

const ATTACHMENT_SSE = buildSseBody([
  {
    id: 'evt-at2-001-1',
    runId: RUN_ID,
    type: 'assistant',
    text: 'The PDF says hello',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'evt-at2-001-2',
    runId: RUN_ID,
    type: 'status',
    payload: { status: 'completed' },
    createdAt: new Date().toISOString(),
  },
]);

test('AC-AT2-001 user attaches a PDF and asks about it', async ({ page }) => {
  let capturedAgentChatBody: string | null = null;

  // Mock ONLY the agent-chat edge function — capture the POST body and return a
  // deterministic grounded SSE answer (no live model). Everything else — thread
  // creation, the agent_attachments INSERT, the real signed Storage upload, and
  // confirmUpload — runs against the real local stack (bucket + RLS from
  // migration 0060, admin@acme.test is seeded). This is the faithful cross-stack
  // proof: mocking the Storage/PostgREST calls would only test the mocks.
  await page.route('**/functions/v1/agent-chat', async (route) => {
    capturedAgentChatBody = route.request().postData();
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
      body: ATTACHMENT_SSE,
    });
  });

  // Sign in and open the Assistant panel
  await signIn(page, 'admin@acme.test');
  await expect(page.getByRole('button', { name: 'Assistant' })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Assistant' }).click();

  const panel = page.getByRole('complementary', { name: /agent assistant/i });
  await expect(panel).toBeVisible({ timeout: 5_000 });

  // Upload the fixture PDF via the hidden file input. Playwright drives the
  // <input type="file"> directly (the visible "Attach file" button just proxies
  // input.click(), which would open a native dialog Playwright cannot script).
  const fileInput = panel.locator('input[type="file"]');
  await fileInput.setInputFiles('e2e/fixtures/tiny-upload.pdf');

  // Wait for the upload to complete — the UI shows "1 attachment ready" when done
  await expect(panel.getByText(/1 attachment ready/i)).toBeVisible({ timeout: 15_000 });

  // Type a question and send
  const textarea = panel.getByRole('textbox', { name: /ask a question/i });
  await textarea.fill('what does this PDF say?');

  const sendButton = panel.getByRole('button', { name: /send message/i });
  await sendButton.click();

  // Wait for the grounded assistant response
  await expect(panel.getByText(/The PDF says hello/i)).toBeVisible({ timeout: 15_000 });

  // ASSERT a: the captured agent-chat POST body carries attachmentIds as a
  // NON-EMPTY array of reference ids (the real uuid minted by the INSERT) —
  // FR-AT2-ATT-007/DEC-6: the reference reached the handler, not the bytes.
  //
  // This e2e owns ONLY the cross-stack shape (one reference, no bytes). Handler-side
  // resolution/extraction/degradation is owned by the UNIT tests (handlerAttachments.test.ts)
  // per ADR-0010, not this e2e — do not add a live-model assertion here.
  expect(capturedAgentChatBody).not.toBeNull();
  const parsedBody = JSON.parse(capturedAgentChatBody!);
  expect(Array.isArray(parsedBody.attachmentIds)).toBe(true);
  // Exactly the one file attached in this fresh conversation, and it must be a uuid.
  expect(parsedBody.attachmentIds).toHaveLength(1);
  expect(parsedBody.attachmentIds[0]).toMatch(/^[0-9a-f-]{36}$/i);
  expect(typeof parsedBody.attachmentIds[0]).toBe('string');

  // ASSERT b: the POST body does NOT carry raw PDF bytes inline — references, not bytes.
  const bodySize = capturedAgentChatBody!.length;
  expect(bodySize).toBeLessThan(10_000); // JSON metadata only, no binary blob
  expect(capturedAgentChatBody!).not.toContain('JVBER'); // base64 PDF magic prefix
  expect(capturedAgentChatBody!).not.toContain('%PDF'); // raw PDF magic prefix

  // ASSERT c: the grounded assistant answer renders in the transcript
  await expect(panel.getByText(/The PDF says hello/i)).toBeVisible();
});