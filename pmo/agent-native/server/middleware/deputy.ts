/**
 * Deputy middleware — populates the host AsyncLocalStorage with the verified
 * caller's raw JWT so agent-native actions (Step 3) can build a caller client.
 *
 * Runs as a Nitro global middleware (scanned from server/middleware/), which
 * executes BEFORE route handlers including agent-native's /_agent-native/**.
 * Nitro composes global middleware via h3's `callMiddleware`, which hands each
 * middleware a real `next` continuation — so wrapping `next()` in
 * `runWithDeputy(...)` keeps the AsyncLocalStorage entered for the ENTIRE
 * downstream chain (route resolution → agent-native handler → action `run`).
 *
 * Flow:
 *   Authorization: Bearer <jwt>  ──►  verifyJwt (service_role: getUser + profiles)
 *        │                                  │
 *        │  absent / invalid                │  ok
 *        ▼                                  ▼
 *   leave ALS empty                  runWithDeputy({ rawJwt, ... }, () => next())
 *   (getSession → anonymous)         (action reads getCallerJwt() downstream)
 *
 * The middleware NEVER rejects the request — it only populates or leaves empty.
 * agent-native's own `getSession` returns null for an empty store, which the
 * framework maps to anonymous. Auth gating (401) is the action's job via
 * `requiresAuth` / `getCallerJwt()` presence.
 *
 * NOTE on the `(event, next)` signature: h3's `defineMiddleware` / Nitro's
 * scanned-middleware contract is `(event, next) => response | next()`. We use
 * a plain async handler returning the wrapped promise so the type surface
 * stays minimal across the h3 RC.
 */
import { getHeader, type H3Event } from "h3";
import { runWithDeputy, type DeputyContext } from "../lib/deputy-store";
import { verifyJwt } from "../lib/supabase";

/** Nitro middleware continuation. Untyped intentionally — h3 RC shapes vary. */
type Next = () => unknown;

function extractBearer(event: H3Event): string | undefined {
  const header = getHeader(event, "authorization");
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || undefined;
}

export default async function deputyMiddleware(event: H3Event, next: Next): Promise<unknown> {
  const jwt = extractBearer(event);
  // No credential → anonymous. Leave the ALS untouched; continue normally.
  if (!jwt) return next();

  const caller = await verifyJwt(jwt);
  // Invalid / expired / unknown JWT → anonymous. Do NOT throw; just continue.
  if (!caller) return next();

  const ctx: DeputyContext = {
    rawJwt: jwt,
    userId: caller.userId,
    email: caller.email,
    orgId: caller.orgId,
    role: caller.role,
  };

  // Enter the deputy scope for the remainder of the request. Returning the
  // promise lets Nitro/h3 await the full downstream response while the ALS
  // stays entered for all async work spawned from it (the action `run`).
  return runWithDeputy(ctx, () => next() as Awaited<ReturnType<Next>>);
}
