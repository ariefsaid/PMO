/** Mint a 256-bit URL-safe opaque state token using Web Crypto. */
export function newOpaqueStateToken(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 43);
}
