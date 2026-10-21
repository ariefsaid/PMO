// Custody transport: one deadline covers headers and JSON; redirects are never followed.
import { FetchDeadlineError, OUTBOUND_FETCH_TIMEOUT_MS } from "../_shared/fetchWithDeadline.ts";

const MAX_JSON_BYTES = 2 * 1024 * 1024;

export async function fetchMicrosoftJson(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit,
  timeoutMs = OUTBOUND_FETCH_TIMEOUT_MS,
): Promise<{ response: Response; data: unknown }> {
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      void reader?.cancel().catch(() => {});
      reject(new FetchDeadlineError(timeoutMs));
    }, timeoutMs); // mutation-witness:microsoft-body-timeout
  });
  const request = async () => {
    const response = await fetchImpl(input, { ...init, signal: controller.signal, redirect: "error" }); // mutation-witness:microsoft-redirect
    if (response.status >= 300 && response.status < 400) throw new Error("Microsoft redirect refused");
    let data: unknown;
    if (response.body) {
      reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_JSON_BYTES) throw new Error("Microsoft response limit");
        chunks.push(chunk.value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch { data = null; }
    } else {
      // Structural Response doubles used by the pure-helper tests expose only json().
      try { data = await response.json(); } catch { data = null; }
    }
    return { response, data };
  };
  try {
    return await Promise.race([request(), deadline]); // mutation-witness:microsoft-body-deadline
  } finally {
    clearTimeout(timer);
    controller.abort();
    void reader?.cancel().catch(() => {});
  }
}
