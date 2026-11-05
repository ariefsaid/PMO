/**
 * Read the request body with a HARD byte cap enforced on the STREAM (M-1 audit fix). The old
 * Content-Length-only check was bypassable: a chunked request (no/short/lying `Content-Length`) let
 * `req.text()` buffer an unbounded body. This reads the body stream and ABORTS once `maxBytes` is
 * exceeded, so the cap holds regardless of the declared length. Returns `null` when the cap is
 * exceeded (the caller replies 413). Falls back to `req.text()` when there is no stream body.
 */
export async function readBodyBounded(req: Request, maxBytes: number): Promise<string | null> {
  if (!req.body) {
    const text = await req.text();
    return new TextEncoder().encode(text).length > maxBytes ? null : text;
  }
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buf.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(buf);
}
