/** Shared ERP site host guard. Refuses special-use literals and any hostname with a non-public answer. */
function ipv4Octets(value: string): number[] | null {
  const parts = value.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null;
  const octets = parts.map(Number);
  return octets.every((part) => part <= 255) ? octets : null;
}

function isPrivateIpv4(value: string): boolean {
  const ip = ipv4Octets(value);
  if (!ip) return false;
  const [a, b] = ip;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

function ipv6Words(value: string): number[] | null {
  let input = value.toLowerCase();
  if (input.includes('.')) {
    const lastColon = input.lastIndexOf(':');
    const v4 = ipv4Octets(input.slice(lastColon + 1));
    if (!v4) return null;
    input = `${input.slice(0, lastColon)}:${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = input.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const words = [...left, ...Array(missing).fill('0'), ...right];
  if (words.length !== 8 || words.some((word) => !/^[0-9a-f]{1,4}$/.test(word))) return null;
  return words.map((word) => parseInt(word, 16));
}

function isPrivateAddress(value: string): boolean {
  const bare = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
  if (isPrivateIpv4(bare)) return true;
  if (!bare.includes(':')) return false;
  const words = ipv6Words(bare);
  if (!words) return true;
  if (words.every((word) => word === 0) || (words.slice(0, 7).every((word) => word === 0) && words[7] === 1)) return true;
  if ((words[0] & 0xffc0) === 0xfe80 || (words[0] & 0xfe00) === 0xfc00) return true; // link-local / unique-local
  const mapped = words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
  if (mapped) return isPrivateIpv4(`${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`);
  return false;
}

let resolverFallbackWarned = false;

function warnResolverFallback(): void {
  if (resolverFallbackWarned) return;
  resolverFallbackWarned = true;
  console.warn('[erp-host-guard] DNS resolution is unavailable; applying hostname-text checks only');
}

function isResolverUnavailable(error: unknown): boolean {
  const name = error instanceof Error ? error.name : '';
  return name === 'NotSupported' || name === 'PermissionDenied';
}

/** Return true on refusal. DNS failures fail closed; both A and AAAA are checked. */
export async function isPrivateOrReservedHost(hostname: string): Promise<boolean> {
  let host = hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (!host.includes(':')) host = host.replace(/:\d+$/, '');
  if (host === 'localhost' || host === 'localhost.localdomain' || host === 'metadata.google.internal' || host === 'metadata.azure.com') return true;
  if (isPrivateAddress(host)) return true;

  // Public address literals do not need DNS (and querying them as names would fail).
  if (ipv4Octets(host) || host.includes(':')) return false;
  const resolver = (globalThis as typeof globalThis & { Deno?: { resolveDns?: (host: string, type: 'A' | 'AAAA') => Promise<string[]> } }).Deno?.resolveDns;
  if (typeof resolver !== 'function') {
    warnResolverFallback();
    return false;
  }
  try {
    const resolve = async (recordType: 'A' | 'AAAA'): Promise<string[]> => {
      try {
        return await resolver(host, recordType);
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) return [];
        throw error;
      }
    };
    const [a, aaaa] = await Promise.all([resolve('A'), resolve('AAAA')]);
    return a.length === 0 && aaaa.length === 0 || [...a, ...aaaa].some(isPrivateAddress);
  } catch (error) {
    if (isResolverUnavailable(error)) {
      warnResolverFallback();
      return false;
    }
    return true;
  }
}

/** URL validation shared by ERP connection and request functions. */
export async function isPermittedErpSiteUrl(siteUrl: string): Promise<boolean> {
  let site: URL;
  try {
    site = new URL(siteUrl);
  } catch {
    return false;
  }
  return site.protocol === 'https:' && !(await isPrivateOrReservedHost(site.hostname));
}
