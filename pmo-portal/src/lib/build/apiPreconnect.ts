import type { Plugin } from 'vite';

/** The `<link rel="preconnect">` for the API origin, or '' when the URL is absent or not http(s). The origin is already public in the bundle. */
export function apiPreconnectTag(apiUrl: string | undefined): string {
  try {
    const { protocol, origin } = new URL(apiUrl ?? '');
    return protocol === 'https:' || protocol === 'http:' ? `<link rel="preconnect" href="${origin}" crossorigin />` : '';
  } catch {
    return '';
  }
}

/** Opens DNS + TLS to the API while the script downloads, so the first read (the profile) does not pay the handshake. */
export function apiPreconnect(): Plugin {
  let apiUrl: string | undefined;
  return {
    name: 'pmo-api-preconnect',
    configResolved(config) { apiUrl = config.env.VITE_SUPABASE_URL; },
    transformIndexHtml(html) {
      const tag = apiPreconnectTag(apiUrl);
      return tag ? html.replace('<title>', `${tag}\n    <title>`) : html;
    },
  };
}
