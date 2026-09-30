/** True when an OAuth client's redirect goes back to this computer (a loopback address, RFC 8252). */
export function isLoopbackRedirect(uri: string): boolean {
  try {
    return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(uri).hostname);
  } catch {
    return false;
  }
}
