// connectClient.ts — the FE transport for the m365-token-custody edge function (Phase-1 wiring,
// ADR-0060). Mirrors adapterSeam/dispatchClient.ts: browser-only `supabase` singleton,
// `functions.invoke('m365-token-custody', { body })`, FunctionsHttpError `.context` body read,
// and an AppError carrying the stable M365ErrorCode as `code` so the UI can classify uniformly.
//
// The edge fn is the ONLY server-side authority over `ms_graph_connections` (RLS forced, zero
// client policy). This module issues exactly two actions: `initiate_connect` (returns the
// Microsoft authorize URL — the FE then top-level-redirects) and `disconnect` (revokes + deletes
// server-side). It does NOT read connection status — there is no client-readable status path
// (gap reported to Director; the card surfaces state only from the callback return).
//
// NFR-M365-101/108 (binding): no token, `oid`, `code_verifier`, or raw internal error string is
// ever surfaced. The edge fn returns only `{ authorizeUrl, state }` (initiate) / `{ success }`
// (disconnect); error responses are mapped BY their stable `error` code to reviewed human copy,
// never echoed. The `state` is a CSRF token bound to the server-side PKCE row — it is not secret,
// but it is also not rendered in the DOM (the card navigates to `authorizeUrl` only).
import { supabase } from '../supabase/client.ts';
import { AppError } from '../appError.ts';

const FN_NAME = 'm365-token-custody';

/** initiate_connect success body (supabase/functions/m365-token-custody/types.ts). */
export interface InitiateConnectResult {
  authorizeUrl: string;
  state: string;
}

/** disconnect success body (revoke.ts → { status: 200, body: { success: true } }). */
interface DisconnectResult {
  success: boolean;
}

/** The edge fn's JSON error body shape ({ error: M365ErrorCode, message: string }). */
interface M365ErrorBody {
  error?: string;
  message?: string;
}

/**
 * Human copy for each code in the M365ErrorCode wire taxonomy
 * (supabase/functions/m365-token-custody/types.ts). The edge fn's `message` is generic; the FE
 * maps by the stable `error` CODE so (a) messaging is consistent + reviewable, (b) a server-side
 * message regression can't leak detail, and (c) the raw code string never reaches the user.
 * Unknown codes + the network fallback share a single generic message.
 */
export function describeM365Error(code: string | undefined): string {
  switch (code) {
    case 'NOT_ENTITLED':
      return "Your organization isn't enabled for the Microsoft 365 integration yet.";
    case 'FORBIDDEN':
      return 'Only an Administrator can connect Microsoft 365.';
    case 'UNAUTHORIZED':
      return 'Your session expired. Refresh the page and try again.';
    case 'CONNECTION_STALE':
      return 'The Microsoft 365 connection expired. Please reconnect.';
    case 'CONNECTION_REVOKED':
      return 'The Microsoft 365 connection was revoked. Connect again to continue.';
    case 'NOT_CONNECTED':
      return "Microsoft 365 isn't connected.";
    case 'TOKEN_EXCHANGE_FAILED':
      return "Microsoft declined the connection. Please try again.";
    case 'INVALID_STATE':
      return 'The connection request expired. Please try again.';
    case 'SCOPE_INSUFFICIENT':
      return 'The connection needs additional permissions. Reconnect to grant them.';
    case 'BAD_REQUEST':
      return 'The request was invalid. Please try again.';
    case 'GRAPH_ERROR':
      return 'Microsoft Graph is unavailable right now. Please try again shortly.';
    case 'INTERNAL_ERROR':
      return 'Something went wrong on our end. Please try again.';
    default:
      return 'Microsoft 365 could not be connected. Please try again.';
  }
}

/**
 * Read the JSON error body off a `FunctionsHttpError`'s `.context` Response (the same pattern as
 * adapterSeam/dispatchClient + db/adminUsers — `FunctionsHttpError` doesn't parse the body itself).
 * Returns `undefined` when there is no context or the body isn't JSON.
 */
async function readErrorBody(error: unknown): Promise<M365ErrorBody | undefined> {
  const context = (error as { context?: Response } | null | undefined)?.context;
  if (!context || typeof context.clone !== 'function') return undefined;
  try {
    return (await context.clone().json()) as M365ErrorBody;
  } catch {
    return undefined;
  }
}

/** A FunctionsHttpError carries a `.context: Response`; a FunctionsFetchError (network) does not. */
function hasHttpResponse(error: unknown): boolean {
  const ctx = (error as { context?: Response } | null | undefined)?.context;
  return !!ctx && typeof (ctx as Response).clone === 'function';
}

/**
 * Pure classification of an invoke error into `{ code, message }` (mirrors dispatchClient's
 * classifyDispatchError — pure + independently tested so the network path is pinned):
 *   1. a NETWORK failure (no HTTP response on `.context`) → `external-unreachable` + the GENERIC
 *      message. The raw fetch string ('name resolution failed', 'Failed to send a request…') is
 *      NEVER surfaced;
 *   2. otherwise → the M365ErrorCode → `describeM365Error` mapping (unknown code → generic).
 */
export function classifyM365InvokeError(
  error: unknown,
  body: M365ErrorBody | undefined,
): { code: string | undefined; message: string } {
  if (!hasHttpResponse(error)) {
    return { code: 'external-unreachable', message: describeM365Error(undefined) };
  }
  const code = body?.error;
  return { code, message: describeM365Error(code) };
}

async function throwClassified(error: unknown): Promise<never> {
  const body = await readErrorBody(error);
  const { code, message } = classifyM365InvokeError(error, body);
  throw new AppError(message, code);
}

/**
 * POST `action: 'initiate_connect'` → `{ authorizeUrl, state }`. On success the FE performs a
 * TOP-LEVEL redirect to `authorizeUrl` (Microsoft's consent page must be user-visible — that lives
 * in the card, not here). Throws `AppError(message, M365ErrorCode)` on any failure.
 */
export async function initiateM365Connect(): Promise<InitiateConnectResult> {
  const { data, error } = await supabase.functions.invoke<InitiateConnectResult>(FN_NAME, {
    body: { action: 'initiate_connect' },
  });
  if (error) await throwClassified(error);
  if (!data || typeof data.authorizeUrl !== 'string' || !data.authorizeUrl) {
    // No partial redirect: a malformed 2xx is a generic failure, never a blank navigation.
    throw new AppError(describeM365Error('INTERNAL_ERROR'), 'INTERNAL_ERROR');
  }
  return data;
}

/**
 * POST `action: 'disconnect'` → server-side best-effort Microsoft revoke + local row delete +
 * audit (revoke.ts, AC-M365-120). Throws `AppError(message, M365ErrorCode)` on any failure
 * (e.g. NOT_CONNECTED if the row is already gone, INTERNAL_ERROR if the delete failed).
 */
export async function disconnectM365(): Promise<void> {
  const { error } = await supabase.functions.invoke<DisconnectResult>(FN_NAME, {
    body: { action: 'disconnect' },
  });
  if (error) await throwClassified(error);
}
