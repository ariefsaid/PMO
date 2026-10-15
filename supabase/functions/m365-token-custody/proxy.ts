// proxy.ts — public graph_proxy action. All connection and Graph transport work is shared with
// the document verifier through graphRead.ts; this wrapper preserves the existing wire contract.

import type { GraphProxyRequest, HandlerDeps, HandlerResult } from "./types.ts";
import {
  type GraphReadSession,
  openCallerGraphRead,
  validateGraphProxyInput,
} from "./graphRead.ts";
export { scopeCoversPath } from "./graphRead.ts";

export async function handleGraphProxy(
  req: GraphProxyRequest,
  deps: HandlerDeps,
): Promise<HandlerResult> {
  const session = await openCallerGraphRead(
    deps,
    () => validateGraphProxyInput(req),
  );
  if (!isSession(session)) return session;
  return await session.get({
    path: req.path,
    method: req.method,
    query: req.query,
    body: req.body,
  });
}

function isSession(
  value: GraphReadSession | HandlerResult,
): value is GraphReadSession {
  return "get" in value;
}
