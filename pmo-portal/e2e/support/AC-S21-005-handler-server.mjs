import { createS21ClickUpFetch } from './AC-S21-005-transport.mjs';

const bootstrapText = await new Response(Deno.stdin.readable).text();
const bootstrap = JSON.parse(bootstrapText);
const supabaseUrl = new URL(bootstrap.supabaseUrl);
if (
  !['127.0.0.1', 'localhost', '[::1]'].includes(supabaseUrl.hostname) ||
  bootstrap.host !== '127.0.0.1' ||
  !Number.isInteger(bootstrap.port) || bootstrap.port < 1 || bootstrap.port > 65535 ||
  !bootstrap.serviceRoleKey || !bootstrap.sentinel
) {
  throw new Error('S21_HOST_BOOTSTRAP_INVALID');
}

Deno.env.set('SUPABASE_URL', bootstrap.supabaseUrl);
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', bootstrap.serviceRoleKey);
Deno.env.set('EDGE_JWT_ISSUER', bootstrap.issuer);

const externalListsHandlerPath = '../../../supabase/functions/external-lists/index.ts';
const externalLinkHandlerPath = '../../../supabase/functions/external-link/index.ts';
const [{ handleListsRequest }, { handleLinkRequest }] = await Promise.all([
  import(externalListsHandlerPath),
  import(externalLinkHandlerPath),
]);

const clickUpTransport = createS21ClickUpFetch({
  supabaseOrigin: supabaseUrl.origin,
  teamId: bootstrap.teamId,
  teamName: bootstrap.teamName,
  spaceId: bootstrap.spaceId,
  spaceName: bootstrap.spaceName,
  listId: bootstrap.listId,
  listName: bootstrap.listName,
  sentinel: bootstrap.sentinel,
  fetchImpl: globalThis.fetch.bind(globalThis),
});
globalThis.fetch = clickUpTransport.fetch;

const postCounts = { externalLists: 0, externalLink: 0 };
const responseStatusCounts = {
  externalLists: {},
  externalLink: {},
};
const controller = new AbortController();
Deno.addSignalListener('SIGTERM', () => controller.abort());

function responseWithCors(response) {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type');
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  return new Response(response.body, { status: response.status, headers });
}

const server = Deno.serve(
  {
    hostname: bootstrap.host,
    port: bootstrap.port,
    signal: controller.signal,
    onListen({ port }) {
      console.log(JSON.stringify({ event: 'ready', port }));
    },
  },
  async (request) => {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') {
      return new Response('ready', { status: 200 });
    }
    if (url.search || url.hash) return new Response(null, { status: 404 });
    if (request.method === 'OPTIONS') {
      if (url.pathname !== '/external-lists' && url.pathname !== '/external-link') {
        return new Response(null, { status: 404 });
      }
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
        },
      });
    }
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    if (Number(request.headers.get('content-length') ?? '0') > 32_768) {
      return new Response(null, { status: 413 });
    }
    if (url.pathname === '/external-lists') {
      if (postCounts.externalLists + postCounts.externalLink >= 16) return new Response(null, { status: 429 });
      postCounts.externalLists += 1;
      const response = responseWithCors(await handleListsRequest(request));
      const key = String(response.status);
      responseStatusCounts.externalLists[key] = (responseStatusCounts.externalLists[key] ?? 0) + 1;
      return response;
    }
    if (url.pathname === '/external-link') {
      if (postCounts.externalLists + postCounts.externalLink >= 16) return new Response(null, { status: 429 });
      postCounts.externalLink += 1;
      const response = responseWithCors(await handleLinkRequest(request));
      const key = String(response.status);
      responseStatusCounts.externalLink[key] = (responseStatusCounts.externalLink[key] ?? 0) + 1;
      return response;
    }
    return new Response(null, { status: 404 });
  },
);

await server.finished;
console.log(JSON.stringify({
  event: 'summary',
  handlerPosts: { ...postCounts },
  handlerResponseStatusCounts: responseStatusCounts,
  clickup: clickUpTransport.snapshot(),
}));
