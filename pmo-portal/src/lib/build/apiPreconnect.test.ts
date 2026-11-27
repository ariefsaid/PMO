import { describe, expect, it } from 'vitest';
import { apiPreconnectTag, apiPreconnect } from './apiPreconnect';

describe('apiPreconnect', () => {
  it('names the API origin only, never a path or key', () => {
    expect(apiPreconnectTag('https://abc.supabase.co/rest/v1?apikey=x')).toBe('<link rel="preconnect" href="https://abc.supabase.co" crossorigin />');
  });
  it('adds nothing for a missing or malformed URL', () => {
    expect(apiPreconnectTag(undefined)).toBe('');
    expect(apiPreconnectTag('not a url')).toBe('');
    expect(apiPreconnectTag('javascript:alert(1)')).toBe('');
  });
  it('injects the tag into index.html before the title', () => {
    const plugin = apiPreconnect() as unknown as { configResolved: (c: unknown) => void; transformIndexHtml: (h: string) => string };
    plugin.configResolved({ env: { VITE_SUPABASE_URL: 'http://localhost:54321' } });
    expect(plugin.transformIndexHtml('<head><title>PMO</title></head>')).toBe('<head><link rel="preconnect" href="http://localhost:54321" crossorigin />\n    <title>PMO</title></head>');
  });
});
