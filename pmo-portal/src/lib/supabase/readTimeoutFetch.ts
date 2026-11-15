/**
 * One app-wide time limit on data reads. Wraps the data client's `fetch`: a GET/HEAD to the REST
 * API that gets no answer within `READ_TIMEOUT_MS` is aborted, so it fails into the screen's normal
 * error state (with its Retry) instead of waiting for as long as the browser keeps it open.
 *
 * Only safe reads are bounded. Writes, RPC calls, edge functions, storage and sign-in keep their own
 * deadlines (`withTimeout`, `invokeWithTimeout`, upload transport) because aborting them client-side
 * cannot tell whether the server applied them.
 */
export const READ_TIMEOUT_MS = 30_000;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function requestInfo(input: RequestInfo | URL, init?: RequestInit): { method: string; url: string } {
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const url = input instanceof Request ? input.url : String(input);
  return { method, url };
}

export function createReadTimeoutFetch(
  baseFetch: FetchLike = (input, init) => fetch(input, init),
  timeoutMs: number = READ_TIMEOUT_MS,
): FetchLike {
  return (input, init) => {
    const { method, url } = requestInfo(input, init);
    const isRead = (method === 'GET' || method === 'HEAD') && url.includes('/rest/v1/');
    if (!isRead) return baseFetch(input, init);

    const controller = new AbortController();
    const caller = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    if (caller) {
      if (caller.aborted) controller.abort(caller.reason);
      else caller.addEventListener('abort', () => controller.abort(caller.reason), { once: true });
    }
    const timer = setTimeout(
      () => controller.abort(new DOMException('The request timed out', 'TimeoutError')),
      timeoutMs,
    );
    return baseFetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
  };
}
