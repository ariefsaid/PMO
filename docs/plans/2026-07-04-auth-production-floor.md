# Implementation Plan: Auth Production Floor (GTM MVP item 2)

> **Spec (authoritative, signed):** `docs/specs/auth-production-floor.spec.md` (2-model battery passed; this
> plan **encodes** it, never re-litigates §3 decisions). **Related:** `docs/specs/auth.spec.md` (Issue #3 —
> login/session/magic-link/impersonation foundation; this issue **extends**, does not duplicate),
> `docs/adr/0047-gtm-production-topology.md` (per-client Supabase Cloud Pro + CF Pages), `docs/adr/0010-test-strategy-pyramid.md`
> (one owning test layer per AC), `docs/adr/0016-fe-authz-primitive-and-impersonation.md` + `0017-repository-api-seam.md`
> (RLS is the enforcement authority).
>
> **House rules (binding):** TDD red→green (a failing test is written before every behavior task's prod code);
> no placeholders (exact paths, real code sketches incl. the supabase-js v2 calls the spec names, exact verify
> commands); 2–5 min tasks; every behavior task names its `AC-AUTHF-###`; one owning test layer per AC
> (ADR-0010). `grep -r AC-AUTHF-…` must find each AC's proof at its owning layer.
>
> **Path facts (grounded):** Vite/tsc alias `@` → `pmo-portal/` (package root). App pages/routes live at the
> **app root** (`App.tsx`), not under `src/`. Auth code lives under `pmo-portal/src/auth/`. The Supabase browser
> client is `pmo-portal/src/lib/supabase/client.ts` (anon key, `detectSessionInUrl: true`). Run all
> `npm`/`vitest`/`playwright` commands inside `pmo-portal/`; run `supabase` from the repo root.
>
> **Existing surfaces this issue extends (grounded):**
> - `App.tsx` root routes: `<Route path="/login" element={<LoginPage />} />` is a **sibling outside**
>   `<RequireAuth />`; protected routes nest under `<Route element={<RequireAuth />}><Route path="/*" element={<Shell />} /></Route>`.
>   New public routes mirror `/login`; the invite-pending gate nests **inside** `<RequireAuth />`.
> - `AuthContext.ts` `AuthContextValue` exposes `{ session, currentUser, role, loading, profileError,
>   signInWithPassword, signInWithMagicLink, signOut }` — each method returns `Promise<{ error: string | null }>`.
>   This issue adds `requestPasswordReset`, `updatePassword`, `resendEmailConfirmation` (same return shape).
> - `AuthProvider.tsx` subscribes to `onAuthStateChange` as `(_event, session) => …` — **the event type is
>   discarded** (spec §1.3 M-4), so `PASSWORD_RECOVERY` is **not** on the context. Recovery detection subscribes
>   **in-page** (`/update-password`). The context *does* expose `session` (so `session.user.user_metadata.invite_pending`
>   is readable for the gate — no context change needed for FR-AUTHF-034).
> - `LoginPage.tsx` defines local primitives `SuccessNotice` (role=status), `ErrorBanner` (role=alert),
>   `InputBlock`. The new pages mirror these exactly (D-AUTHF-12).
> - `RequireAuth.tsx`: `loading → AuthLoading`; `!session → <Navigate to="/login" />`; `profileError → ProfileErrorPage`;
>   else `<Outlet />`. The invite-pending gate is a **sibling** that composes with it, not a replacement.
> - `supabase/config.toml`: `[auth] site_url = "http://127.0.0.1:3000"`, `enable_confirmations = false`,
>   `[auth.rate_limit] email_sent = 2`, `[api] auto_expose_new_tables` is commented (opt-in), `[inbucket]` on
>   port 54324 (local mail sink — **Mailpit** in current Supabase; the existing `e2e/AC-AUTH-005.spec.ts`
>   polls `http://127.0.0.1:54324/api/v1/messages`).
> - `e2e/helpers.ts`: `signIn(page, email)`, `SEED_PASSWORD = 'Passw0rd!dev'`. `e2e/AC-AUTH-005.spec.ts` is the
>   canonical Mailpit-polling pattern to reuse.
> - Analytics: `events.ts` `AuthMethod = 'password' | 'magic_link'`, `AuthFailureReason = 'invalid_credentials'
>   | 'auth_error'`; `index.ts` exposes `trackAuthLoginSucceeded(method)` / `trackAuthLoginFailed(method, reason_code)`.
>
> **ID namespace:** `AUTHF` (this issue) is distinct from `AUTH` (`auth.spec.md`). No ID is reused.

---

## Design summary (decisions encoded by this plan)

### D1 — Recovery/invite session detection is in-page, race-free, URL-param-gated (FR-AUTHF-020/021/027)
`AuthProvider` discards the `onAuthStateChange` event type (M-4), so `/update-password` detects a usable
recovery/invite session itself. The deterministic signal: **the URL carried auth params** (`type` / `token` /
`refresh_token` / `access_token` / `code` / `error` / `error_code` / `error_description` — present in either
`search` or `hash`; supabase-js does **not** strip them, FR-AUTHF-027 strips them here) **and** a session
resolves. Concretely the page:
1. reads `hasRecoveryParams` synchronously at mount → if false, renders the **expired** state immediately
   (FR-AUTHF-021 "direct navigation"); if true, starts in `verifying`;
2. subscribes to `onAuthStateChange` → on `PASSWORD_RECOVERY` with a session → `active` + `history.replaceState`
   to the clean `/update-password` (FR-AUTHF-027);
3. calls `getSession()` → if it already has a session (token consumed before mount) → `active` + strip; if no
   session and no event landed → `expired` (invalid/expired token, FR-AUTHF-021).

Whichever of (2)/(3) lands first activates; this is race-free because both converge on the same `activate()`.
A recovery link and a Supabase invite link both resolve through the recovery token flow (both emit
`PASSWORD_RECOVERY`), so D-AUTHF-4 ("one page serves reset + invite") holds with no branch. The unreachable
"params + session but no event" path is defensive-only — real recovery/invite flows always emit the event —
so holding at `verifying` there (a spinner) is preferred over wrongly showing `expired` on a real reset.

### D2 — The invite-pending gate is a router layout route nested inside RequireAuth (FR-AUTHF-034, AC-AUTHF-016)
A new `<RequireInviteAccepted />` renders `<Outlet />` or `<Navigate to="/update-password" replace />` based on
`session?.user?.user_metadata?.invite_pending === true`. It mounts **inside** `<RequireAuth />` (so session +
profile are already resolved) and **wraps** `<Shell />`; `/update-password` stays **outside** both, so the
redirect cannot loop (NFR-AUTHF-REL-002). The success path clears `invite_pending` in the same `updateUser`
call (FR-AUTHF-035), so the post-set-password navigation to `/` is not bounced back. A recovery-only session
(flag absent/false) is **not** redirected (D-AUTHF-14). **Not a security boundary** — `user_metadata` is
user-writable; RLS bounds reads either way (FR-AUTHF-034 honesty note). Owned by a router-level unit test.

### D3 — The AuthContext seam gains three thin wrappers (spec §1.3)
`requestPasswordReset`, `updatePassword`, `resendEmailConfirmation` — each a one-liner over the anon-key
GoTrue client, returning `{ error: string | null }` to mirror `signInWithPassword`. `updatePassword` **always**
sends `data: { invite_pending: false }` (FR-AUTHF-035 — idempotent for the pure-reset case). The wrappers
centralize the origin-rooted `redirectTo`/`emailRedirectTo` so AC-AUTHF-030 (redirect safety) is provable at
the seam.

### D4 — Auth-form primitives are extracted, not triplicated (D-AUTHF-12)
`LoginPage.tsx`'s local `SuccessNotice` / `ErrorBanner` / `InputBlock` move to `src/auth/authFormPrimitives.tsx`
(behavior-preserving); `LoginPage` imports them; the two new pages import the same set. Guarantees the three
auth pages are visually identical (same tokens, same a11y) with zero risk to the existing `LoginPage.test.tsx`
behavior assertions.

### D5 — Config: local stays Inbucket-backed; SMTP is a documented template (§7.1a vs §1.3)
The committed `config.toml` is the **local** template. Local dev mail **must** keep flowing to Inbucket
(port 54324) — the existing `AC-AUTH-005` magic-link e2e **and** this issue's `AC-AUTHF-005`/`020` e2e poll
Mailpit there. So the `[auth.email.smtp]` Resend block is added **commented** (the `env(RESEND_API_KEY)` form,
documented; a dev uncommenting it + setting `RESEND_API_KEY` in `.env` can test real SMTP delivery locally,
which then routes mail away from Inbucket). The active config change is `auto_expose_new_tables = false`
(NFR-AUTHF-CONF-006). Cloud SMTP is a **dashboard** step (literal key, no `env()`) — §7.1b, delivered as the
`docs/environments.md` runbook. This honors binding §1.3 ("local stays as-is") over §7.1a's illustrative active
block; flagged for Director awareness in Open Questions.

### D6 — e2e honest testable boundary (AC-AUTHF-005, AC-AUTHF-020)
Both e2e run against the **local stack + Mailpit (54324)**, reusing the `AC-AUTH-005` polling pattern. Reset
(`AC-AUTHF-005`): seeded user → `/reset-password` → Mailpit → follow link → `/update-password` → set password
→ `/` signed in → re-sign-in with the **new** password works (old fails). Invite (`AC-AUTHF-020`): test
**setup** stands in for GTM item 1a issuance by calling the **service-role admin API** —
`auth.admin.inviteUserByEmail(email, { data: { invite_pending: true } })` + a matching `profiles` insert — then
the Mailpit-driven acceptance + gate-clear assertion. The service-role key is read from
`process.env.SUPABASE_SERVICE_ROLE_KEY` (developer exports it from `supabase status`; CI from
`supabase status --output json`); the spec **skips** cleanly when it is absent (no false green). No real SMTP,
no PII, no live-verify runbook in CI — that boundary is documented, not faked.

---

## Phase 0 — Foundations (analytics union + auth-form primitives + AuthContext seam)

> These three tasks are prerequisites for slices 1–4. Each is independently verify-green.

### 0.1 (RED→GREEN) Extend `AuthMethod` + `AuthFailureReason` (FR-AUTHF-061, D-AUTHF-13)
- **File:** `pmo-portal/src/lib/analytics/events.ts`.
- **Test (RED first):** append to `pmo-portal/src/lib/analytics/events.test.ts` (the file already exists — append to it):
  ```ts
  import { describe, it, expectTypeOf } from 'vitest';
  import type { AuthMethod, AuthFailureReason } from './events';

  describe('auth analytics unions (FR-AUTHF-061)', () => {
    it('AuthMethod includes password_reset + invite_accept', () => {
      const m: AuthMethod[] = ['password', 'magic_link', 'password_reset', 'invite_accept'];
      expectTypeOf(m).toEqualTypeOf<AuthMethod[]>();
    });
    it('AuthFailureReason includes email_not_confirmed + weak_password + expired_token', () => {
      const r: AuthFailureReason[] = ['invalid_credentials', 'auth_error', 'email_not_confirmed', 'weak_password', 'expired_token'];
      expectTypeOf(r).toEqualTypeOf<AuthFailureReason[]>();
    });
  });
  ```
  *(If a runtime assertion is preferred over `expectTypeOf`, assert `['password_reset','invite_accept','email_not_confirmed','weak_password','expired_token']` are assignable by constructing values.)*
  *(RED is observed at **`npm run typecheck`**, NOT at `vitest` — `expectTypeOf` is type-level and erased at runtime, so `vitest run` passes either way; `tsc` is what fails until the union extends in the GREEN step. This is also the first use of `expectTypeOf` in the repo — fine in vitest 4.1.9, but a stylistic first worth noting.)*
- **Change (GREEN):**
  ```ts
  export type AuthMethod = 'password' | 'magic_link' | 'password_reset' | 'invite_accept';
  export type AuthFailureReason =
    | 'invalid_credentials' | 'auth_error'
    | 'email_not_confirmed' | 'weak_password' | 'expired_token';
  ```
- **Verify:** `cd pmo-portal && npx vitest run src/lib/analytics/events.test.ts` green; `npm run typecheck` 0 errors.

### 0.2 (GREEN) Extract auth-form primitives; refactor LoginPage to import them (D-AUTHF-12, behavior-preserving)
- **File (new):** `pmo-portal/src/auth/authFormPrimitives.tsx`.
- **Content** (verbatim move of the three components currently inline in `LoginPage.tsx`, exported):
  ```tsx
  import React from 'react';
  import { cn } from '../components/ui/cn';
  import { Icon } from '../components/ui/icons';

  /** Tinted success notice (magic-link sent / check-your-email / confirmation sent). */
  export const SuccessNotice: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div
      role="status"
      aria-live="polite"
      className="flex items-start gap-2 rounded-md border border-success/30 bg-success/[0.07] px-3 py-2.5 text-[13px]"
    >
      <Icon name="check" className="mt-px size-4 shrink-0 text-success" aria-hidden="true" />
      <span style={{ color: 'hsl(142 60% 30%)' }}>{children}</span>
    </div>
  );

  /** Tinted error banner (credential / network / weak-password error). */
  export const ErrorBanner: React.FC<{ message: string }> = ({ message }) => (
    <div
      role="alert"
      aria-live="assertive"
      className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/[0.07] px-3 py-2.5 text-[13px]"
    >
      <Icon name="alert" className="mt-px size-4 shrink-0 text-destructive" aria-hidden="true" />
      <span style={{ color: 'hsl(0 72% 42%)' }}>{message}</span>
    </div>
  );

  /** Single labeled input block — label above, value controlled by parent. */
  export const AuthInput: React.FC<{
    id: string;
    label: string;
    type: React.HTMLInputTypeAttribute;
    autoComplete?: string;
    required?: boolean;
    value: string;
    onChange: (v: string) => void;
    errorId?: string;
    disabled?: boolean;
  }> = ({ id, label, type, autoComplete, required, value, onChange, errorId, disabled }) => (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground"
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        autoComplete={autoComplete}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-describedby={errorId}
        className={cn(
          'h-8 w-full rounded-md border border-input bg-background px-2.5 text-[13.5px] text-foreground',
          'placeholder:text-muted-foreground',
          'transition-[border-color,box-shadow] duration-100',
          'disabled:cursor-not-allowed disabled:opacity-45',
        )}
      />
    </div>
  );
  ```
- **File (edit):** `pmo-portal/src/auth/LoginPage.tsx` — delete the three inline component definitions (`SuccessNotice`, `ErrorBanner`, `InputBlock`) and replace the single existing usage of `<InputBlock … />` with `<AuthInput … />`; add `import { SuccessNotice, ErrorBanner, AuthInput } from './authFormPrimitives';`. Remove the now-unused `cn`/`Icon` imports from `LoginPage.tsx` only if nothing else in the file still uses them (the demo panel + page wrapper do not use `cn`/`Icon` directly — confirm with `grep`).
- **Verify:** `cd pmo-portal && npx vitest run src/auth/LoginPage.test.tsx` green (the existing behavior tests are unaffected — they query by role/text/label, not by import location); `npm run typecheck` 0 errors; `grep -n "const SuccessNotice\|const ErrorBanner\|const InputBlock" src/auth/LoginPage.tsx` returns nothing.

### 0.3 (RED→GREEN) Extend the AuthContext seam with the three new methods (FR-AUTHF-011/015/022/035/041, D3)
- **File (test):** append to `pmo-portal/src/auth/AuthProvider.test.tsx`. Add `resetPasswordForEmail`, `updateUser`, `resend` to the existing `supabase.auth` mock object and three tests inside a new `describe('AuthContext auth-floor methods')`:
  ```ts
  // add to the vi.mock supabase.auth object:
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  resend: vi.fn(),

  // new describe (render <AuthProvider><Probe/></AuthProvider> where Probe pulls the three methods):
  it('requestPasswordReset calls resetPasswordForEmail with origin-rooted redirectTo (FR-AUTHF-011/015)', async () => {
    mockedReset.mockResolvedValueOnce({ error: null });
    const r = await probe.requestPasswordReset('x@example.com');
    expect(mockedReset).toHaveBeenCalledWith('x@example.com', { redirectTo: 'http://localhost:3000/update-password' });
    expect(r).toEqual({ error: null });
  });
  it('updateUser sends password + invite_pending=false in one call (FR-AUTHF-022/035)', async () => {
    mockedUpdate.mockResolvedValueOnce({ error: null });
    const r = await probe.updatePassword('NewPass1!');
    expect(mockedUpdate).toHaveBeenCalledWith({ password: 'NewPass1!', data: { invite_pending: false } });
    expect(r).toEqual({ error: null });
  });
  it('resendEmailConfirmation calls resend({ type: signup, email, origin redirect }) (FR-AUTHF-041)', async () => {
    mockedResend.mockResolvedValueOnce({ error: null });
    const r = await probe.resendEmailConfirmation('x@example.com');
    expect(mockedResend).toHaveBeenCalledWith({ type: 'signup', email: 'x@example.com', options: { emailRedirectTo: 'http://localhost:3000' } });
    expect(r).toEqual({ error: null });
  });
  ```
  *(Probe = a small component that calls `useAuth()` and exposes the methods via a ref/callback so the test can await them; mirror the existing `Probe` pattern in this file. Use `vi.mocked` or `vi.hoisted` refs to the three mocked fns.)*
- **Verify (RED):** `cd pmo-portal && npx vitest run src/auth/AuthProvider.test.tsx` fails (methods missing on the context value).
- **File (edit):** `pmo-portal/src/auth/AuthContext.ts` — extend `AuthContextValue`:
  ```ts
  requestPasswordReset: (email: string) => Promise<{ error: string | null }>;
  updatePassword: (password: string) => Promise<{ error: string | null }>;
  resendEmailConfirmation: (email: string) => Promise<{ error: string | null }>;
  ```
- **File (edit):** `pmo-portal/src/auth/AuthProvider.tsx` — add three `useCallback` impls and thread them into the `useMemo` value + dep array:
  ```ts
  const requestPasswordReset = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/update-password`,
    });
    return { error: error?.message ?? null };
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    // FR-AUTHF-035: clear invite_pending in the SAME call (idempotent for pure-reset).
    const { error } = await supabase.auth.updateUser({
      password,
      data: { invite_pending: false },
    });
    return { error: error?.message ?? null };
  }, []);

  const resendEmailConfirmation = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    return { error: error?.message ?? null };
  }, []);
  ```
  Add `requestPasswordReset`, `updatePassword`, `resendEmailConfirmation` to the `useMemo` value object and its dependency array.
- **Verify (GREEN):** `cd pmo-portal && npx vitest run src/auth/AuthProvider.test.tsx` green; `npm run typecheck` 0 errors.

### 0.4 (GREEN) Phase-0 full-suite gate — `npm run verify` before Slice 1
- **Why:** Phase 0 touches three surfaces that **every** login/auth-dependent test renders — the
  `AuthMethod`/`AuthFailureReason` unions (0.1), the extracted `authFormPrimitives` (0.2 — a verbatim-move
  refactor of `LoginPage.tsx`), and the `AuthContext` seam (0.3). The binding house rule (AGENTS.md →
  "Pre-push full verify") exists precisely because *"targeted runs MISS cross-component breakage"* — a subtle
  runtime effect of 0.2's move (a retained/removed `cn`/`Icon` import, a wrapper-div query shift) or a missed
  `useMemo` dep in 0.3 will **not** surface in the per-file `vitest run <file>` calls above; it surfaces only
  when the ~all-auth-rendering suite runs together. Running the full gate **now** — before Slices 1–6 are built
  on top of this seam — isolates any Phase-0 regression to Phase 0, instead of it surfacing far downstream at
  Phase 7 (the plan's own Phase-7 note flags this exact risk for the `authFormPrimitives`/`AuthContext` seam).
- **Verify (from `pmo-portal/`):**
  ```bash
  npm run verify            # = typecheck && lint:ci && test && build  (the WHOLE suite — not just touched files)
  ```
  - `npm run typecheck` → 0 errors.
  - `npm run lint:ci` → 0 warnings (`--max-warnings=0`).
  - `npm test` → all Vitest green (no existing auth/login test regressed from the 0.2 refactor or the 0.3 seam extension).
  - `npm run build` → succeeds.
- **Binding note:** this is a **Phase-0 gate**, not merely a pre-push gate — do **not** proceed to Slice 1
  until the full `npm run verify` is green. The targeted `vitest run <file>` calls inside 0.1–0.3 are for the
  inner TDD loop only.

---

## Slice 1 — `/reset-password` request page (independently verify-green)

> Covers: **AC-AUTHF-001, AC-AUTHF-002, AC-AUTHF-003, AC-AUTHF-004** (all unit/RTL, `ResetPasswordPage.test.tsx`); plus the `/login` "Forgot password?" link (**FR-AUTHF-003**) and the `/reset-password` route wiring (**FR-AUTHF-001**).

### 1.1 (RED) Test: ResetPasswordPage renders the request form (AC-AUTHF-001)
- **File (new):** `pmo-portal/src/auth/ResetPasswordPage.test.tsx`. Mock `@/src/lib/supabase/client` exactly as `LoginPage.test.tsx` does (the page consumes `useAuth().requestPasswordReset`, which calls the mocked client). Render inside `<AuthProvider><MemoryRouter><ResetPasswordPage/></MemoryRouter></AuthProvider>`.
  ```ts
  it('AC-AUTHF-001: renders email field, Send reset link action, and Back-to-sign-in link; no demo panel', () => {
    render(...);
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send reset link/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to sign in/i })).toHaveAttribute('href', '/login');
    // FR-AUTHF-060 (half of AC-AUTHF-035 is owned separately): no demo panel on this page
    expect(screen.queryByText(/Passw0rd!dev/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Executive|Admin/i })).toBeNull();
  });
  ```

### 1.2 (RED) Test: valid email calls resetPasswordForEmail with origin-rooted redirect (AC-AUTHF-002)
- **File:** append to `ResetPasswordPage.test.tsx`.
  ```ts
  it('AC-AUTHF-002: submitting a valid email calls resetPasswordForEmail with origin + /update-password', async () => {
    resetPasswordForEmail.mockResolvedValueOnce({ error: null });
    render(...);
    await userEvent.type(screen.getByLabelText(/email/i), 'someone@example.com');
    await userEvent.click(screen.getByRole('button', { name: /send reset link/i }));
    await waitFor(() => {
      expect(resetPasswordForEmail).toHaveBeenCalledWith('someone@example.com', {
        redirectTo: window.location.origin + '/update-password',
      });
    });
    // FR-AUTHF-011 loading disables the form mid-flight — assert aria-busy while pending using a never-resolving mock variant (separate test if needed).
  });
  ```

### 1.3 (RED) Test: success notice has client-observable parity (AC-AUTHF-003)
- **File:** append to `ResetPasswordPage.test.tsx`.
  ```ts
  it('AC-AUTHF-003: the check-your-email notice is byte-identical for a known vs unknown email', async () => {
    // GoTrue returns { error: null } for both — the client renders the same notice either way (D-AUTHF-7).
    for (const email of ['pm@acme.test', 'nobody@nowhere.test']) {
      resetPasswordForEmail.mockReset();
      resetPasswordForEmail.mockResolvedValueOnce({ error: null });
      const { unmount } = render(...);
      await userEvent.type(screen.getByLabelText(/email/i), email);
      await userEvent.click(screen.getByRole('button', { name: /send reset link/i }));
      const notice = await screen.findByRole('status');
      expect(notice.textContent).toMatch(/check your email/i);
      const snapshot = notice.outerHTML;
      unmount();
      // second iteration asserts the same snapshot string (store first run's string in a var outside the loop)
    }
  });
  ```
  *(Concretely: capture `notice.outerHTML` on the first email, store it, and `expect(secondNotice.outerHTML).toBe(firstSnapshot)` after the second render. The mocked client resolves `{error:null}` for both → identical rendered notice — proving the SPA adds no client-side existence signal. The server-side timing/email-receipt side channel is out of unit reach and is bounded by §7.4.)*

### 1.4 (RED) Test: request error shows an inline banner and stays on page (AC-AUTHF-004)
- **File:** append to `ResetPasswordPage.test.tsx`.
  ```ts
  it('AC-AUTHF-004: a network/rate-limit error renders an ErrorBanner and no unhandled rejection', async () => {
    resetPasswordForEmail.mockRejectedValueOnce(new Error('network'));
    render(...);
    await userEvent.type(screen.getByLabelText(/email/i), 'someone@example.com');
    await userEvent.click(screen.getByRole('button', { name: /send reset link/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    // no navigation away (MemoryRouter — assert the Send reset link button is still in the document)
    expect(screen.getByRole('button', { name: /send reset link/i })).toBeInTheDocument();
  });
  ```
  *(The page must `try/catch` the rejection and surface it via `ErrorBanner`; the test asserting `getByRole('alert')` proves no unhandled promise rejection escaped.)*

### 1.5 (GREEN) Implement ResetPasswordPage (FR-AUTHF-010/011/012/013/014/015/060)
- **File (new):** `pmo-portal/src/auth/ResetPasswordPage.tsx`.
  ```tsx
  import React, { useState } from 'react';
  import { Link } from 'react-router-dom';
  import { useAuth } from './useAuth';
  import { Button } from '../components/ui/Button';
  import { Card, CardPad } from '../components/ui/Card';
  import { ErrorBanner, SuccessNotice, AuthInput } from './authFormPrimitives';

  const ResetPasswordPage: React.FC = () => {
    const { requestPasswordReset } = useAuth();
    const [email, setEmail] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [sent, setSent] = useState(false);
    const [busy, setBusy] = useState(false);

    const onSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setBusy(true);
      try {
        const { error } = await requestPasswordReset(email); // origin + '/update-password' (FR-AUTHF-015/050)
        if (error) { setError(error); setBusy(false); return; }
        setSent(true);           // FR-AUTHF-012 — stay on page; do NOT navigate.
        setBusy(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong'); // FR-AUTHF-014
        setBusy(false);
      }
    };

    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-secondary/35 px-4 py-8">
        <div className="w-full max-w-sm">
          <div className="mb-5 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">PMO Portal</p>
            <h1 className="mt-1 text-[22px] font-bold leading-[1.2] tracking-[-0.02em] text-foreground">Reset your password</h1>
          </div>
          <Card>
            <CardPad className="space-y-4">
              {error && <ErrorBanner message={error} />}
              {/* FR-AUTHF-012/013: identical notice whether or not the email exists (D-AUTHF-7). */}
              {sent && <SuccessNotice>If an account exists for that email, a reset link is on its way.</SuccessNotice>}
              <form onSubmit={onSubmit} className="space-y-4" noValidate>
                <AuthInput id="email" label="Email" type="email" autoComplete="email" required
                  value={email} onChange={setEmail} disabled={busy} />
                <Button type="submit" variant="primary" loading={busy} disabled={busy} className="w-full">
                  Send reset link
                </Button>
              </form>
              <Link to="/login" className="block text-center text-[12.5px] font-semibold text-primary-text hover:underline">
                Back to sign in
              </Link>
            </CardPad>
          </Card>
        </div>
      </div>
    );
  };
  export default ResetPasswordPage;
  ```
- **Verify (GREEN):** `cd pmo-portal && npx vitest run src/auth/ResetPasswordPage.test.tsx` green (001–004); `npm run typecheck` 0 errors.

### 1.6 (GREEN) Wire the `/reset-password` route + add the "Forgot password?" link on `/login` (FR-AUTHF-001/003)
- **File (edit):** `pmo-portal/App.tsx`. Add the lazy import + the public route as a sibling of `/login` (outside `<RequireAuth />`):
  ```tsx
  const ResetPasswordPage = React.lazy(() => import('@/src/auth/ResetPasswordPage'));
  // …inside <Routes> (root), as a sibling of <Route path="/login" …/>:
  <Route path="/reset-password" element={<ResetPasswordPage />} />
  ```
  *(Place it eagerly if preferred — auth pages are never lazy-split per the existing pattern; `LoginPage` is eager. Mirror that: `import ResetPasswordPage from '@/src/auth/ResetPasswordPage';` and the route above, no `React.lazy`.)*
- **File (edit):** `pmo-portal/src/auth/LoginPage.tsx` — inside the `<form>` (below the password `AuthInput`, above the Sign-in `Button`), add:
  ```tsx
  <div className="flex justify-end">
    <Link to="/reset-password" className="text-[12px] font-semibold text-primary-text hover:underline">
      Forgot password?
    </Link>
  </div>
  ```
  Add `import { Link } from 'react-router-dom';` (already imported? `LoginPage` currently imports only `useNavigate` — add `Link`).
- **Verify:** `cd pmo-portal && npm run typecheck` 0 errors; `npx vitest run src/auth/LoginPage.test.tsx` green (existing tests unaffected); `npx vitest run src/auth/ResetPasswordPage.test.tsx` green. Slice 1 complete + green.

---

## Slice 2 — `/update-password` page (recovery session handling + token-URL cleanup) (independently verify-green)

> Covers: **AC-AUTHF-010, AC-AUTHF-011, AC-AUTHF-012, AC-AUTHF-013, AC-AUTHF-014, AC-AUTHF-015, AC-AUTHF-017** (all unit/RTL, `UpdatePasswordPage.test.tsx`); plus the **AC-AUTHF-035** demo-credential gate (unit, `authPagesNoDemo.test.tsx` — owns it for BOTH new pages).

### 2.1 (RED) Test: valid recovery session renders the set-password form (AC-AUTHF-010)
- **File (new):** `pmo-portal/src/auth/UpdatePasswordPage.test.tsx`. Mock the client (`getSession`, `onAuthStateChange`, `updateUser`); capture the `onAuthStateChange` callback into a `vi.hoisted` array so the test can drive it.
  ```ts
  it('AC-AUTHF-010: an active recovery session renders new-password + confirm + Set new password', async () => {
    // URL carries recovery params → page starts in 'verifying'; a session resolves → 'active'.
    window.history.replaceState({}, '', '/update-password?type=recovery&token=abc&refresh_token=xyz');
    getSession.mockResolvedValueOnce({ data: { session: { user: { id: 'u1', user_metadata: {} } } } });
    render(<AuthProvider><MemoryRouter><UpdatePasswordPage/></MemoryRouter></AuthProvider>);
    await waitFor(() => expect(screen.getByLabelText(/new password/i)).toBeVisible());
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /set new password/i })).toBeInTheDocument();
  });
  ```

### 2.2 (RED) Test: mismatched confirm password blocks submit with inline validation (AC-AUTHF-011)
- **File:** append.
  ```ts
  it('AC-AUTHF-011: mismatched passwords show an inline error and do NOT call updateUser', async () => {
    window.history.replaceState({}, '', '/update-password?type=recovery&token=abc');
    getSession.mockResolvedValueOnce({ data: { session: { user: { id: 'u1', user_metadata: {} } } } });
    render(...);
    await waitFor(() => expect(screen.getByLabelText(/new password/i)).toBeVisible());
    await userEvent.type(screen.getByLabelText(/new password/i), 'NewPass1!');
    await userEvent.type(screen.getByLabelText(/confirm password/i), 'NewPass2!');
    await userEvent.click(screen.getByRole('button', { name: /set new password/i }));
    expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument();
    expect(updateUser).not.toHaveBeenCalled();
  });
  ```

### 2.3 (RED) Test: submitting calls updateUser with password + invite_pending=false (AC-AUTHF-012)
- **File:** append.
  ```ts
  it('AC-AUTHF-012: matching passwords call updateUser({ password, data: { invite_pending: false } }) and no PII is tracked', async () => {
    window.history.replaceState({}, '', '/update-password?type=recovery&token=abc');
    getSession.mockResolvedValueOnce({ data: { session: { user: { id: 'u1', user_metadata: {} } } } });
    updateUser.mockResolvedValueOnce({ error: null });
    render(...);
    await waitFor(() => expect(screen.getByLabelText(/new password/i)).toBeVisible());
    await userEvent.type(screen.getByLabelText(/new password/i), 'BrandNewPass1!');
    await userEvent.type(screen.getByLabelText(/confirm password/i), 'BrandNewPass1!');
    await userEvent.click(screen.getByRole('button', { name: /set new password/i }));
    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ password: 'BrandNewPass1!', data: { invite_pending: false } }));
    // FR-AUTHF-061 (owned fully by AC-AUTHF-036; assert here only that the password value never reaches analytics):
    expect(JSON.stringify(trackAuthLoginSucceeded.mock.calls)).not.toContain('BrandNewPass1!');
  });
  ```

### 2.4 (RED) Test: success navigates to `/` (AC-AUTHF-013)
- **File:** append. Mock `useNavigate` via the same `vi.hoisted` + `vi.mock('react-router-dom', …)` pattern as `LoginPage.test.tsx`.
  ```ts
  it('AC-AUTHF-013: on updateUser success the router navigates to / (replace)', async () => {
    window.history.replaceState({}, '', '/update-password?type=recovery&token=abc');
    getSession.mockResolvedValueOnce({ data: { session: { user: { id: 'u1', user_metadata: {} } } } });
    updateUser.mockResolvedValueOnce({ error: null });
    render(...);
    await waitFor(() => expect(screen.getByLabelText(/new password/i)).toBeVisible());
    await userEvent.type(screen.getByLabelText(/new password/i), 'BrandNewPass1!');
    await userEvent.type(screen.getByLabelText(/confirm password/i), 'BrandNewPass1!');
    await userEvent.click(screen.getByRole('button', { name: /set new password/i }));
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/', { replace: true }));
  });
  ```

### 2.5 (RED) Test: weak-password error stays on page with an inline banner (AC-AUTHF-014)
- **File:** append.
  ```ts
  it('AC-AUTHF-014: a weak-password error renders an ErrorBanner and stays on /update-password', async () => {
    window.history.replaceState({}, '', '/update-password?type=recovery&token=abc');
    getSession.mockResolvedValueOnce({ data: { session: { user: { id: 'u1', user_metadata: {} } } } });
    updateUser.mockResolvedValueOnce({ error: { message: 'Password should be at least 10 characters.' } });
    render(...);
    await waitFor(() => expect(screen.getByLabelText(/new password/i)).toBeVisible());
    await userEvent.type(screen.getByLabelText(/new password/i), 'short1');
    await userEvent.type(screen.getByLabelText(/confirm password/i), 'short1');
    await userEvent.click(screen.getByRole('button', { name: /set new password/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(navigateSpy).not.toHaveBeenCalled();
  });
  ```

### 2.6 (RED) Test: expired/invalid token renders the expired state, not the form (AC-AUTHF-015)
- **File:** append. Two variants; assert at least the direct-nav one deterministically.
  ```ts
  it('AC-AUTHF-015: direct navigation (no params) renders the expired state, not the form', () => {
    window.history.replaceState({}, '', '/update-password');
    render(...);
    expect(screen.getByText(/invalid or expired/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /request a new link/i })).toHaveAttribute('href', '/reset-password');
    expect(screen.queryByLabelText(/new password/i)).toBeNull();
  });
  it('AC-AUTHF-015: params + no session (invalid/expired token) renders the expired state', async () => {
    window.history.replaceState({}, '', '/update-password?type=recovery&token=stale');
    getSession.mockResolvedValueOnce({ data: { session: null } });
    render(...);
    await waitFor(() => expect(screen.getByText(/invalid or expired/i)).toBeInTheDocument());
    expect(screen.queryByLabelText(/new password/i)).toBeNull();
  });
  ```

### 2.7 (RED) Test: recovery/invite token is stripped from the URL after session establishment (AC-AUTHF-017)
- **File:** append.
  ```ts
  it('AC-AUTHF-017: after a recovery session establishes, the URL is the clean /update-password path', async () => {
    window.history.replaceState({}, '', '/update-password?type=recovery&token=abc&refresh_token=xyz');
    getSession.mockResolvedValueOnce({ data: { session: { user: { id: 'u1', user_metadata: {} } } } });
    render(...);
    await waitFor(() => expect(screen.getByLabelText(/new password/i)).toBeVisible());
    // FR-AUTHF-027: history.replaceState stripped the params (supabase-js does not).
    expect(window.location.pathname).toBe('/update-password');
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('');
  });
  ```

### 2.8 (GREEN) Implement UpdatePasswordPage (FR-AUTHF-002/020/021/022/023/024/025/026/027/035)
- **File (new):** `pmo-portal/src/auth/UpdatePasswordPage.tsx`. (See the full sketch in §D1 of the design summary; the key pieces:)
  ```tsx
  import React, { useEffect, useMemo, useState } from 'react';
  import { Link, useNavigate } from 'react-router-dom';
  import { supabase } from '@/src/lib/supabase/client';
  import { useAuth } from './useAuth';
  import { Button } from '../components/ui/Button';
  import { Card, CardPad } from '../components/ui/Card';
  import { ErrorBanner, AuthInput } from './authFormPrimitives';
  import { trackAuthLoginSucceeded, trackAuthLoginFailed } from '@/src/lib/analytics';
  import type { AuthFailureReason, AuthMethod } from '@/src/lib/analytics';

  const RECOVERY_PARAMS = ['type','token','refresh_token','access_token','code','error','error_code','error_description'];

  const classifyUpdateError = (message: string): AuthFailureReason => {
    const m = message.toLowerCase();
    if (m.includes('weak') || m.includes('at least') || m.includes('password should')) return 'weak_password';
    if (m.includes('expired') || m.includes('token') || m.includes('invalid')) return 'expired_token';
    return 'auth_error';
  };

  const UpdatePasswordPage: React.FC = () => {
    const navigate = useNavigate();
    const { session, updatePassword } = useAuth();

    // FR-AUTHF-020/021/027 + spec §1.3 M-4: AuthProvider discards the event type, so detection is in-page.
    const hasRecoveryParams = useMemo(() => {
      const u = new URL(window.location.href);
      return RECOVERY_PARAMS.some((k) => u.searchParams.has(k)) || RECOVERY_PARAMS.some((k) => u.hash.includes(`${k}=`));
    }, []);
    const [phase, setPhase] = useState<'verifying' | 'active' | 'expired'>(hasRecoveryParams ? 'verifying' : 'expired');

    useEffect(() => {
      if (!hasRecoveryParams) return;
      let settled = false;
      const activate = () => {
        if (settled) return;
        settled = true;
        setPhase('active');
        window.history.replaceState({}, '', '/update-password'); // FR-AUTHF-027
      };
      const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
        if (event === 'PASSWORD_RECOVERY' && s) activate();
      });
      void supabase.auth.getSession().then(({ data }) => {
        if (data.session) activate();
        else if (!settled) { settled = true; setPhase('expired'); }
      });
      return () => sub.subscription.unsubscribe();
    }, [hasRecoveryParams]);

    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [confirmError, setConfirmError] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const wasInvite = session?.user?.user_metadata?.invite_pending === true;
    const method: AuthMethod = wasInvite ? 'invite_accept' : 'password_reset';

    const onSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      if (password !== confirm || !password) { setConfirmError('Passwords do not match'); return; } // FR-AUTHF-022
      setConfirmError(null);
      setBusy(true);
      const { error } = await updatePassword(password); // FR-AUTHF-035: clears invite_pending in the same call
      setBusy(false);
      if (error) { trackAuthLoginFailed(method, classifyUpdateError(error)); setError(error); return; } // FR-AUTHF-025
      trackAuthLoginSucceeded(method);                  // FR-AUTHF-061
      navigate('/', { replace: true });                 // FR-AUTHF-024
    };

    if (phase === 'expired') {
      return (
        <div className="flex min-h-[100dvh] items-center justify-center bg-secondary/35 px-4 py-8">
          <div className="w-full max-w-sm">
            <div className="mb-5 text-center">
              <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">PMO Portal</p>
              <h1 className="mt-1 text-[22px] font-bold leading-[1.2] tracking-[-0.02em] text-foreground">Set your password</h1>
            </div>
            <Card>
              <CardPad className="space-y-4">
                <ErrorBanner message="This link is invalid or expired." />
                <Link to="/reset-password">
                  <Button type="button" variant="primary" className="w-full">Request a new link</Button>
                </Link>
                <Link to="/login" className="block text-center text-[12.5px] font-semibold text-primary-text hover:underline">Back to sign in</Link>
              </CardPad>
            </Card>
          </div>
        </div>
      );
    }
    if (phase === 'verifying') {
      return (
        <div role="status" aria-live="polite" aria-label="Verifying your link…"
             className="flex min-h-[100dvh] items-center justify-center bg-secondary/35">
          <svg className="size-7 animate-spin text-primary" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          <span className="sr-only">Verifying your link…</span>
        </div>
      );
    }
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-secondary/35 px-4 py-8">
        <div className="w-full max-w-sm">
          <div className="mb-5 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">PMO Portal</p>
            <h1 className="mt-1 text-[22px] font-bold leading-[1.2] tracking-[-0.02em] text-foreground">
              {wasInvite ? 'Set your password' : 'Set a new password'}
            </h1>
          </div>
          <Card>
            <CardPad className="space-y-4">
              {error && <ErrorBanner message={error} />}
              <form onSubmit={onSubmit} className="space-y-4" noValidate>
                <AuthInput id="new-password" label="New password" type="password" autoComplete="new-password" required
                  value={password} onChange={setPassword} disabled={busy} />
                {/* AuthInput already wraps its label+input in `flex flex-col gap-1.5`; use a PLAIN wrapper here
                    (the form's `space-y-4` separates this field-group from siblings) and give the error its own
                    `mt-1.5` so it sits in the same 6px rhythm as AuthInput's internal gap — no double flex-col. */}
                <div>
                  <AuthInput id="confirm-password" label="Confirm password" type="password" autoComplete="new-password" required
                    value={confirm} onChange={setConfirm} disabled={busy} errorId="confirm-err" />
                  {confirmError && (
                    <span id="confirm-err" role="alert" className="mt-1.5 flex items-center gap-1.5 text-[12px] font-medium"
                          style={{ color: 'hsl(0 72% 45%)' }}>
                      {confirmError}
                    </span>
                  )}
                </div>
                <Button type="submit" variant="primary" loading={busy} disabled={busy} className="w-full">Set new password</Button>
              </form>
            </CardPad>
          </Card>
        </div>
      </div>
    );
  };
  export default UpdatePasswordPage;
  ```
- **Verify (GREEN):** `cd pmo-portal && npx vitest run src/auth/UpdatePasswordPage.test.tsx` green (010/011/012/013/014/015/017); `npm run typecheck` 0 errors.

### 2.9 (GREEN) Wire the `/update-password` route (FR-AUTHF-001)
- **File (edit):** `pmo-portal/App.tsx`. Add `import UpdatePasswordPage from '@/src/auth/UpdatePasswordPage';` and the public route sibling:
  ```tsx
  <Route path="/reset-password" element={<ResetPasswordPage />} />
  <Route path="/update-password" element={<UpdatePasswordPage />} />
  ```
  *(Both new public routes sit beside `/login`, outside `<RequireAuth />`.)*
- **Verify:** `cd pmo-portal && npm run typecheck` 0 errors.

### 2.10 (RED→GREEN) New auth pages never surface demo credentials (AC-AUTHF-035)
- **File (new):** `pmo-portal/src/auth/authPagesNoDemo.test.tsx` — **owns** AC-AUTHF-035 for BOTH pages.
  ```ts
  it('AC-AUTHF-035: with VITE_DEMO_MODE=true, neither /reset-password nor /update-password shows demo credentials', () => {
    vi.stubEnv('VITE_DEMO_MODE', 'true');
    // /reset-password
    const r1 = render(<AuthProvider><MemoryRouter><ResetPasswordPage/></MemoryRouter></AuthProvider>);
    expect(r1.queryByText(/Passw0rd!dev/i)).toBeNull();
    expect(r1.queryByRole('button', { name: /Executive|Admin|Finance/i })).toBeNull();
    r1.unmount();
    // /update-password (expired state — no form, but assert no demo panel either)
    window.history.replaceState({}, '', '/update-password');
    const r2 = render(<AuthProvider><MemoryRouter><UpdatePasswordPage/></MemoryRouter></AuthProvider>);
    expect(r2.queryByText(/Passw0rd!dev/i)).toBeNull();
    expect(r2.queryByRole('button', { name: /Executive|Admin|Finance/i })).toBeNull();
    vi.unstubAllEnvs();
  });
  ```
  *(No prod change — this proves the pages never read `VITE_DEMO_MODE`. Test goes RED→GREEN on first run against the Slice-1/Slice-2 implementations.)*
- **Verify:** `cd pmo-portal && npx vitest run src/auth/authPagesNoDemo.test.tsx` green. Slice 2 complete + green.

---

## Slice 3 — `invite_pending` route gate + `INVITE_PENDING` contract (independently verify-green)

> Covers: **AC-AUTHF-016** (unit/router-test, `RequireInviteAccepted.test.tsx`). The gate composes with `RequireAuth` (FR-AUTHF-034, D2). The producer side of the contract (`invite_pending=false` on success) is owned by FR-AUTHF-035 / AC-AUTHF-012 (Slice 2); the consumer side is this gate.

### 3.1 (RED) Test: invite-pending user is redirected from protected routes; recovery-only is not (AC-AUTHF-016)
- **File (new):** `pmo-portal/src/auth/RequireInviteAccepted.test.tsx`. Use the `vi.hoisted` mutable-session pattern from `AuthProvider.test.tsx` so the test can set `user.user_metadata.invite_pending`.
  ```ts
  const state = vi.hoisted(() => ({ session: null as any, profile: null as any }));
  // vi.mock @/src/lib/supabase/client → getSession→state.session; onAuthStateChange→no-op unsubscribe;
  //   from('profiles')→ state.profile; signOut→ok.

  function tree(initial: string) {
    return (
      <MemoryRouter initialEntries={[initial]}>
        <AuthProvider>
          <Routes>
            <Route path="/update-password" element={<div>UPDATE PASSWORD PAGE</div>} />
            <Route element={<RequireAuth />}>
              <Route element={<RequireInviteAccepted />}>
                <Route path="/" element={<div>PROTECTED HOME</div>} />
              </Route>
            </Route>
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );
  }

  it('AC-AUTHF-016: a signed-in user with user_metadata.invite_pending===true is redirected to /update-password', async () => {
    state.session = { user: { id: 'u1', user_metadata: { invite_pending: true } } };
    state.profile = { id: 'u1', role: 'Project Manager', full_name: 'Invitee', /* …required profile fields… */ };
    render(tree('/'));
    await waitFor(() => expect(screen.getByText('UPDATE PASSWORD PAGE')).toBeInTheDocument());
    expect(screen.queryByText('PROTECTED HOME')).toBeNull();
  });

  it('AC-AUTHF-016: a recovery-only session (invite_pending absent) is NOT redirected by the gate (D-AUTHF-14)', async () => {
    state.session = { user: { id: 'u1', user_metadata: {} } };
    state.profile = { id: 'u1', role: 'Project Manager', full_name: 'PM', /* … */ };
    render(tree('/'));
    await waitFor(() => expect(screen.getByText('PROTECTED HOME')).toBeInTheDocument());
    expect(screen.queryByText('UPDATE PASSWORD PAGE')).toBeNull();
  });
  ```
  *(Provide a minimal valid `Profile` object — mirror the shape used in `AuthProvider.test.tsx`'s `state.profile`.)*

### 3.2 (GREEN) Implement RequireInviteAccepted (FR-AUTHF-034, D2)
- **File (new):** `pmo-portal/src/auth/RequireInviteAccepted.tsx`.
  ```tsx
  import React from 'react';
  import { Navigate, Outlet } from 'react-router-dom';
  import { useAuth } from './useAuth';

  /**
   * Sibling invite-pending gate (FR-AUTHF-034, I-1 GATE decision). Mounts INSIDE <RequireAuth />
   * (session + profile already resolved) and WRAPS the protected shell. While the signed-in user
   * carries user_metadata.invite_pending === true (the §1.2 INVITE_PENDING flag stamped by GTM
   * item 1a issuance), every protected route redirects to /update-password so an invitee cannot
   * browse the app passwordless. /update-password sits OUTSIDE this boundary → no loop
   * (NFR-AUTHF-REL-002); the success path clears invite_pending in the same updateUser call
   * (FR-AUTHF-035). A recovery-only session (flag absent/false) is NOT redirected (D-AUTHF-14).
   *
   * NOT a security boundary — user_metadata is user-writable; RLS bounds reads either way
   * (FR-AUTHF-034 honesty note). This is a UX / lockout-prevention gate.
   */
  export const RequireInviteAccepted: React.FC = () => {
    const { session } = useAuth();
    const invitePending = session?.user?.user_metadata?.invite_pending === true;
    if (invitePending) return <Navigate to="/update-password" replace />;
    return <Outlet />;
  };
  ```

### 3.3 (GREEN) Nest the gate inside RequireAuth in App.tsx (FR-AUTHF-034)
- **File (edit):** `pmo-portal/App.tsx`. Import `RequireInviteAccepted` and nest it:
  ```tsx
  <Route path="/login" element={<LoginPage />} />
  <Route path="/reset-password" element={<ResetPasswordPage />} />
  <Route path="/update-password" element={<UpdatePasswordPage />} />
  <Route element={<RequireAuth />}>
    <Route element={<RequireInviteAccepted />}>
      <Route path="/*" element={<Shell />} />
    </Route>
  </Route>
  ```
- **Verify:** `cd pmo-portal && npx vitest run src/auth/RequireInviteAccepted.test.tsx` green (AC-AUTHF-016); `npm run typecheck` 0 errors; `npx vitest run src/auth/RequireAuth.test.tsx` green (the existing guard still works — the gate is additive). Slice 3 complete + green.

---

## Slice 4 — Email-confirmation / resend states on `/login` (independently verify-green)

> Covers: **AC-AUTHF-025, AC-AUTHF-026, AC-AUTHF-027** (unit/RTL, `LoginPage.test.tsx`); plus the cross-cutting **AC-AUTHF-030** (redirect safety, `authRedirects.test.tsx`) and **AC-AUTHF-036** (analytics, no PII, `authFloorAnalytics.test.tsx`).

### 4.1 (RED) Test: confirm-required error → confirm state (AC-AUTHF-025)
- **File (edit):** append to `pmo-portal/src/auth/LoginPage.test.tsx`. The existing mock already mocks `signInWithPassword`; add a test where it rejects with a GoTrue "email not confirmed" message.
  ```ts
  it('AC-AUTHF-025: a "email not confirmed" error renders the confirm-required state, not the generic banner', async () => {
    auth.signInWithPassword.mockResolvedValueOnce({ error: { message: 'Email not confirmed' } });
    renderLogin();
    await userEvent.type(screen.getByLabelText(/email/i), 'pm@acme.test');
    await userEvent.type(screen.getByLabelText(/password/i), 'Passw0rd!dev');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(screen.getByText(/confirm your email/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /resend confirmation/i })).toBeInTheDocument();
    // NOT the generic error banner
    expect(screen.queryByRole('alert')).toBeNull();
  });
  ```
  *(The classification is by error string alone — `/email not confirmed/i` (FR-AUTHF-043). No build flag.)*

### 4.2 (RED) Test: Resend calls resend({ type: 'signup', email }) with the origin redirect (AC-AUTHF-026)
- **File:** append. Add `resend: vi.fn()` to the existing supabase.auth mock.
  ```ts
  it('AC-AUTHF-026: Resend calls resend({ type: signup, email, options: { emailRedirectTo: origin } })', async () => {
    auth.signInWithPassword.mockResolvedValueOnce({ error: { message: 'Email not confirmed' } });
    resend.mockResolvedValueOnce({ error: null });
    renderLogin();
    await userEvent.type(screen.getByLabelText(/email/i), 'pm@acme.test');
    await userEvent.type(screen.getByLabelText(/password/i), 'Passw0rd!dev');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /resend confirmation/i })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /resend confirmation/i }));
    await waitFor(() => expect(resend).toHaveBeenCalledWith({
      type: 'signup', email: 'pm@acme.test', options: { emailRedirectTo: window.location.origin },
    }));
  });
  ```

### 4.3 (RED) Test: Resend success shows "confirmation sent"; rate-limit shows a rate-limit message + disables (AC-AUTHF-027)
- **File:** append.
  ```ts
  it('AC-AUTHF-027: resend success shows a status notice; a rate-limit error shows a rate-limit message and disables the action', async () => {
    // success
    auth.signInWithPassword.mockResolvedValueOnce({ error: { message: 'Email not confirmed' } });
    resend.mockResolvedValueOnce({ error: null });
    renderLogin();
    await userEvent.type(screen.getByLabelText(/email/i), 'pm@acme.test');
    await userEvent.type(screen.getByLabelText(/password/i), 'Passw0rd!dev');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await userEvent.click(await screen.findByRole('button', { name: /resend confirmation/i }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/confirmation sent/i));

    // rate-limit (fresh render)
    cleanup();
    auth.signInWithPassword.mockResolvedValueOnce({ error: { message: 'Email not confirmed' } });
    resend.mockResolvedValueOnce({ error: { message: 'For security purposes, you can only request this once every 60 seconds' } });
    renderLogin();
    await userEvent.type(screen.getByLabelText(/email/i), 'pm@acme.test');
    await userEvent.type(screen.getByLabelText(/password/i), 'Passw0rd!dev');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await userEvent.click(await screen.findByRole('button', { name: /resend confirmation/i }));
    await waitFor(() => expect(screen.getByText(/too many|rate limit|try again/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /resend confirmation/i })).toBeDisabled();
  });
  ```
  *(Use `cleanup()` between the two sub-flows or split into two `it`s — preferred: two `it`s for clarity. The rate-limit classifier: message matches `/for security purposes|rate limit|once every/i` → rate-limit branch, disable the button.)*

### 4.4 (GREEN) Implement the confirm-required state + Resend in LoginPage (FR-AUTHF-040/041/042/043)
- **File (edit):** `pmo-portal/src/auth/LoginPage.tsx`.
  - Add `resendEmailConfirmation` to the `useAuth()` destructure.
  - Add a classifier at module scope:
    ```ts
    const isEmailNotConfirmed = (message: string) => /email not confirmed/i.test(message);
    const isRateLimited = (message: string) => /for security purposes|rate limit|once every/i.test(message);
    ```
  - Add state: `const [confirmRequired, setConfirmRequired] = useState(false);` and `const [resendBusy, setResendBusy] = useState(false);` and `const [rateLimited, setRateLimited] = useState(false);`.
  - In `onSignIn`, before falling through to `setError(error)`:
    ```ts
    if (isEmailNotConfirmed(error)) {
      trackAuthLoginFailed('password', 'email_not_confirmed'); // FR-AUTHF-061
      setConfirmRequired(true);
      setBusy(false);
      return;
    }
    ```
  - Add an `onResend` handler:
    ```ts
    const onResend = async () => {
      setError(null); setNotice(null); setResendBusy(true);
      const { error } = await resendEmailConfirmation(email); // FR-AUTHF-041 — origin redirect
      setResendBusy(false);
      if (error) {
        if (isRateLimited(error)) { setRateLimited(true); return; } // FR-AUTHF-042 — disable until retry
        setError(error);
        return;
      }
      setNotice('Confirmation sent. Check your email.');           // FR-AUTHF-042 — role=status (SuccessNotice)
    };
    ```
  - Render the confirm-required block in place of the form when `confirmRequired` (notice + "Resend confirmation" `Button` with `disabled={resendBusy || rateLimited}`); otherwise the existing form. Keep `ErrorBanner`/`SuccessNotice` for the non-confirm paths. The `SuccessNotice` already provides `role="status"`; the confirm-required notice uses it too.
- **Verify (GREEN):** `cd pmo-portal && npx vitest run src/auth/LoginPage.test.tsx` green (existing + 025/026/027); `npm run typecheck` 0 errors.

### 4.5 (RED→GREEN) Every client-side auth redirectTo equals the origin (AC-AUTHF-030)
- **File (new):** `pmo-portal/src/auth/authRedirects.test.tsx` — **owns** AC-AUTHF-030. Mock the client; call the three wrapped methods via `useAuth()` (reset, magic-link, resend) and assert the `redirectTo`/`emailRedirectTo` is the origin (reset → `origin + '/update-password'`) and never a query-string/user value.
  ```ts
  it('AC-AUTHF-030: resetPasswordForEmail, signInWithOtp (magic link), and resend all pass an origin-only redirect', async () => {
    resetPasswordForEmail.mockResolvedValue({ error: null });
    signInWithOtp.mockResolvedValue({ error: null });
    resend.mockResolvedValue({ error: null });
    const probe = renderProbe(); // exposes the three useAuth methods
    await probe.requestPasswordReset('a@b.test');
    await probe.signInWithMagicLink('a@b.test');
    await probe.resendEmailConfirmation('a@b.test');
    expect(resetPasswordForEmail).toHaveBeenCalledWith('a@b.test', { redirectTo: window.location.origin + '/update-password' });
    expect(signInWithOtp).toHaveBeenCalledWith(expect.objectContaining({ email: 'a@b.test', options: expect.objectContaining({ emailRedirectTo: window.location.origin }) }));
    expect(resend).toHaveBeenCalledWith({ type: 'signup', email: 'a@b.test', options: { emailRedirectTo: window.location.origin } });
    // never reflects a query string or user input — the wrappers hardcode window.location.origin.
  });
  ```
  *(Probe = the same small component used in task 0.3 that exposes `useAuth()` methods. No prod change — proves the seam.)*
- **Verify:** `cd pmo-portal && npx vitest run src/auth/authRedirects.test.tsx` green.

### 4.6 (RED→GREEN) New auth methods/reason codes are tracked without PII (AC-AUTHF-036)
- **File (new):** `pmo-portal/src/auth/authFloorAnalytics.test.tsx` — **owns** AC-AUTHF-036. Exercises the success + failure paths across the flows and asserts the tracking calls + zero PII.
  ```ts
  it('AC-AUTHF-036: success/failure tracking uses the new codes and never carries PII', async () => {
    // reset-success: UpdatePasswordPage on a successful SET after a reset (wasInvite===false → 'password_reset').
    // (The /reset-password REQUEST page does not track a login — a reset request is not a login.)
    window.history.replaceState({}, '', '/update-password?type=recovery&token=abc');
    getSession.mockResolvedValueOnce({ data: { session: { user: { id: 'u1', user_metadata: {} } } } });
    updateUser.mockResolvedValueOnce({ error: null });
    renderUpdate(); await submitMatched('BrandNewPass1!');
    expect(trackAuthLoginSucceeded).toHaveBeenCalledWith('password_reset');

    // invite-accept success (wasInvite===true → 'invite_accept')
    window.history.replaceState({}, '', '/update-password?type=recovery&token=def');
    getSession.mockResolvedValueOnce({ data: { session: { user: { id: 'u2', user_metadata: { invite_pending: true } } } } });
    updateUser.mockResolvedValueOnce({ error: null });
    renderUpdate(); await submitMatched('InvitePass1!');
    expect(trackAuthLoginSucceeded).toHaveBeenCalledWith('invite_accept');

    updateUser.mockResolvedValueOnce({ error: { message: 'Password should be at least 10 characters.' } });
    renderUpdate(); await submitMatched('short1');
    expect(trackAuthLoginFailed).toHaveBeenCalledWith(expect.any(String), 'weak_password');

    // confirm-required on login
    signInWithPassword.mockResolvedValueOnce({ error: { message: 'Email not confirmed' } });
    renderLogin(); await submitCredentials('pm@acme.test', 'Passw0rd!dev');
    expect(trackAuthLoginFailed).toHaveBeenCalledWith('password', 'email_not_confirmed');

    // expired-token failure — classifyUpdateError maps a token/expired message → 'expired_token'
    updateUser.mockResolvedValueOnce({ error: { message: 'Token has expired or is invalid' } });
    renderUpdate(); await submitMatched('AnotherPass1!');
    expect(trackAuthLoginFailed).toHaveBeenCalledWith(expect.any(String), 'expired_token');

    // PII guard: no email/password/token in ANY analytics call
    const all = JSON.stringify([...trackAuthLoginSucceeded.mock.calls, ...trackAuthLoginFailed.mock.calls]);
    expect(all).not.toMatch(/someone@example\.com|pm@acme\.test|BrandNewPass1!|InvitePass1!|Passw0rd!dev|token/i);
  });
  ```
  *(The reset-success assertion drives **`UpdatePasswordPage`**'s `wasInvite===false` branch (a successful set after a reset), not the `/reset-password` request page — a reset request is not a login. The `expired_token` reason is exercised via `classifyUpdateError` mapping a `'Token has expired or is invalid'` message.)*
- **Verify:** `cd pmo-portal && npx vitest run src/auth/authFloorAnalytics.test.tsx` green. Slice 4 complete + green.

---

## Slice 5 — `config.toml` (local) + runbook docs (§7) (independently verify-green)

> Covers: the **local** half of NFR-AUTHF-CONF-001/002/006 (config) + the **runbook deliverable** NFR-AUTHF-CONF-007 (the `docs/environments.md` "Production auth configuration" section whose binding content is the spec's §7.1b/7.2/7.3/7.4/7.5/7.6/7.7). **Not** in the §6 automatable AC battery (owner-gated, per-client — spec §7).

### 5.1 (GREEN) config.toml: opt in `auto_expose_new_tables=false` + Resend SMTP template (NFR-AUTHF-CONF-006, §7.1a)
- **File (edit):** `supabase/config.toml`.
- **Change 1 — uncomment + set `auto_expose_new_tables = false` under `[api]`** (currently a 3-line comment block ending `# auto_expose_new_tables = false`, around line 24). Replace:
  ```toml
  # Controls whether new tables, views, sequences and functions created in the `public` schema by
  # `postgres` are reachable through the Data API roles (`anon`, `authenticated`, `service_role`)
  # without explicit GRANTs. Leave unset today to preserve local behaviour. The implicit default
  # flips to `false` on 2026-05-30 to match the new cloud default, and the field is removed in
  # 2026-10-30 once the always-revoked behaviour is permanent. Set to `false` to opt in early.
  # auto_expose_new_tables = false
  ```
  with:
  ```toml
  # Controls whether new tables, views, sequences and functions created in the `public` schema by
  # `postgres` are reachable through the Data API roles without explicit GRANTs. Opted IN to the
  # secure default (false) — matches the production runbook (NFR-AUTHF-CONF-006, auth-floor §7.6).
  auto_expose_new_tables = false
  ```
- **Change 2 — replace the commented Sendgrid SMTP block** (currently around lines 246–253):
  ```toml
  # Use a production-ready SMTP server
  # [auth.email.smtp]
  # enabled = true
  # host = "smtp.sendgrid.net"
  # port = 587
  # user = "apikey"
  # pass = "env(SENDGRID_API_KEY)"
  # admin_email = "admin@email.com"
  # sender_name = "Admin"
  ```
  with the **Resend** template (kept COMMENTED — see D5: enabling SMTP locally routes mail away from Inbucket on :54324, which the auth e2e depends on; uncomment only to test real SMTP delivery with a valid `RESEND_API_KEY` in `.env`):
  ```toml
  # Production auth email via Resend over SMTP (D-AUTHF-1; NFR-AUTHF-CONF-001/002; auth-floor §7.1a).
  # LOCAL TEMPLATE ONLY — kept commented so local dev keeps using the Inbucket testing server on :54324
  # (the auth e2e — AC-AUTH-005, AC-AUTHF-005, AC-AUTHF-020 — polls Mailpit there). To test real SMTP
  # delivery locally, uncomment, set RESEND_API_KEY in .env, and `supabase stop && supabase start`.
  # CLOUD is configured in the dashboard with the LITERAL key (no env()) — see docs/environments.md
  # "Production auth configuration" (§7.1b). No domain is hardcoded in this repo (D-AUTHF-2).
  # [auth.email.smtp]
  # enabled      = true
  # host         = "smtp.resend.com"                  # confirm against Resend's current SMTP docs at provisioning
  # port         = 465                                 # 465 (SSL) or 587 (STARTTLS) per Resend docs
  # user         = "resend"                            # Resend SMTP user; password = the API key
  # pass         = "env(RESEND_API_KEY)"               # LOCAL ONLY — config.toml resolves this from the dev env
  # admin_email  = "<sender-address>@<verified-domain>"# CONFIG VALUE — no domain hardcoded in repo
  # sender_name  = "<Product or Org name>"             # CONFIG VALUE
  ```
- **Verify:** `supabase stop && supabase start` (repo root) brings the stack up clean (the active change is only `auto_expose_new_tables=false`; SMTP stays commented → Inbucket remains the mail sink); `curl -s http://127.0.0.1:54324/api/v1/messages` responds (Mailpit still up); `supabase db reset` completes; the existing `cd pmo-portal && npx playwright test e2e/AC-AUTH-005.spec.ts` still passes (magic-link email still captured by Mailpit — proof SMTP is NOT enabled locally).

### 5.2 (GREEN) Runbook: add "Production auth configuration" to docs/environments.md (NFR-AUTHF-CONF-007, §7.1b/7.2/7.3/7.4/7.5/7.6/7.7)
- **File (edit):** `docs/environments.md` — append a new top-level section before the final `## Self-hosted (Docker/VPS) later` section.
- **Content (binding per spec §7; no real domain/secret committed):**
  ```markdown
  ## Production auth configuration (per-client Supabase Cloud project — owner-gated)

  > Binding source: `docs/specs/auth-production-floor.spec.md` §7 (NFR-AUTHF-CONF-001…008). This is a
  > **runbook**, not code — it mutates a live Supabase Cloud project per client (ADR-0047) and is an
  > **owner checkpoint at client provisioning**. The Operator completes 7.1–7.6 as the final auth step of
  > "add org"; record completion against the client's registry row below. **No domain or secret is
  > committed** (D-AUTHF-2). Cloud SMTP is configured differently from local (§7.1a local TOML `env()`
  # vs §7.1b cloud dashboard literal key).

  ### 7.1 SMTP via Resend
  The Resend API key lives in the 1Password client vault (vault `AS` pattern); the sender domain is
  **verified in Resend**, not in this repo (D-AUTHF-2). **Never commit the key.**

  - **7.1a Local dev** — `supabase/config.toml` `[auth.email.smtp]` supports `env(RESEND_API_KEY)`
    substitution. Kept commented in the committed template so local dev keeps using the Inbucket testing
    server on :54324 (the auth e2e depends on it). To test real SMTP delivery locally: uncomment the block,
    set `RESEND_API_KEY` in `.env`, `supabase stop && supabase start`.
  - **7.1b Cloud project — dashboard Auth → SMTP Settings (LITERAL key, NOT `env()`).** GoTrue SMTP on a
    Supabase Cloud project is configured in the dashboard; the dashboard does NOT accept the `env(...)`
    form — the **literal** API key goes in the SMTP password field. `supabase secrets set RESEND_API_KEY=…`
    configures **edge-function** secrets and does NOT configure GoTrue SMTP; do not use it for this step.
    1. Retrieve the key from 1Password (vault `AS`): the `re_…` secret for this client.
    2. Dashboard → **Authentication → SMTP Settings** → enable **Custom SMTP**.
    3. Enter: Host `smtp.resend.com`; Port `465` (or `587` per Resend docs); Username `resend`;
       **Password = the literal `re_…` API key from 1Password** (paste directly — no `env()` wrapping);
       Sender email = `<sender-address>@<verified-domain>`; Sender name = `<Product or Org name>`;
       Minimum interval per the project's needs.
    4. **Save**, then send the dashboard **test email** and confirm receipt.

  ### 7.2 Redirect allowlist (Auth → URL configuration)
  - `site_url` = the client's deployed **HTTPS** Cloudflare Pages URL (e.g. `https://<client>.<host>`).
  - `additional_redirect_urls` = the same HTTPS origin (covering `/login`, `/update-password`).
  - No `localhost`, no `http`, no wildcard, no second origin (NFR-AUTHF-CONF-003).

  ### 7.3 Auth toggles
  - `enable_confirmations = true` (email confirmation required) — NFR-AUTHF-CONF-004.
  - `enable_signup = false` (invite-only — GTM item 1a issues all users) — NFR-AUTHF-CONF-004.
  - `enable_anonymous_sign_ins` stays `false`.
  - `minimum_password_length` / `password_requirements` ≥ local template (`>=10`, `lower_upper_letters_digits`).

  ### 7.4 Rate-limit & captcha (Auth → Rate limits / Auth → Captcha)
  The reset/confirm/invite endpoints this issue exposes are the primary abuse surface. Two distinct knobs
  (both verified against the committed `supabase/config.toml` comments):
  - `[auth.rate_limit] email_sent = 2` — **per-hour email count cap** (the `config.toml` comment reads "Number
    of emails that can be sent per hour"). Intended production value **`2`** (mirrors the committed template;
    tune per client). Bounds overall volume from the reset/confirm/invite endpoints.
  - `[auth.email] max_frequency = "60s"` — **per-address minimum-seconds throttle** (the `config.toml` comment
    reads "Controls the minimum amount of time that must pass before sending another signup confirmation or
    password reset email"). Intended production value **`"60s"`** — one reset/confirm/invite email per address
    per minute, tighter than the dev template's `"1s"`; the **primary per-address** abuse lever (tune per
    client).
  - `[auth.captcha]` — enable (hCaptcha / Cloudflare Turnstile per the project) for production once the
    provider keys are provisioned; `enabled = true` + `provider` + the secret/site-key pair is a per-client
    provisioning value (**no key committed**). Intended production value: **enabled**.
  - **Rate-limit-vs-enumeration interaction (D-AUTHF-7, NFR-AUTHF-SEC-001):** a sender who is rate-limited
    learns the endpoint was hit repeatedly for that address — a side channel distinct from the client-rendered
    message parity the app controls. The app cannot eliminate this (server-side), so the client keeps the
    rendered notice constant (FR-AUTHF-013) and treats a rate-limit response the same as other transient
    errors from the user's point of view; `email_sent` (hourly cap) + `max_frequency` (per-address throttle)
    + captcha bound the leakage rate.

  ### 7.5 Seed-credential hygiene (real client projects only — not staging/demo)
  - Rotate or disable the `Passw0rd!dev` / `admin@acme.test` user.
  - **Do not run** `scripts/db-seed-prod.sh` or `supabase/seed-admin.sql`.
  - **Do not set** `VITE_DEMO_MODE=true` on the client's CF Pages environment (the login demo panel must not
    appear) (NFR-AUTHF-CONF-005, FR-AUTHF-060).

  ### 7.6 Table exposure
  - `auth.auto_expose_new_tables=false` on the cloud project (Data API settings) — opted-in in the committed
    `supabase/config.toml` (NFR-AUTHF-CONF-006).

  ### 7.7 Provisioning sign-off
  The Operator (glossary) completes 7.1–7.6 as the final step of new-client provisioning (ADR-0047: this *is*
  the "add org" operation's auth step). Recorded against the client's registry row in `## Registry` above.
  ```
- **Verify:** `grep -n "Production auth configuration" docs/environments.md` returns the new heading; `grep -niE "re_[a-z0-9]{10,}|Passw0rd!dev" docs/environments.md` returns nothing inside the new section (no real key committed; `Passw0rd!dev` appears only as the literal-to-rotate, which is fine); markdown lints clean (`npx markdownlint docs/environments.md` if configured, else visual). Slice 5 complete.

---

## Slice 6 — e2e journeys (local stack + Mailpit) (independently verify-green)

> Covers: **AC-AUTHF-005** (password-reset round-trip) and **AC-AUTHF-020** (invite-acceptance round-trip + gate clears). Both are real cross-stack flows against the local Supabase stack + Mailpit (port 54324), reusing the `AC-AUTH-005` polling pattern. **Honest boundary (D6):** Mailpit-driven, no real SMTP; the invite setup uses the **service-role admin API** (standing in for GTM item 1a issuance) and `test.skip`s cleanly when `SUPABASE_SERVICE_ROLE_KEY` is absent.

### 6.1 (GREEN) Helper: poll Mailpit for an auth link + service-role client (D6)
- **File (edit):** `pmo-portal/e2e/helpers.ts` — append. The Mailpit interaction is **split into two helpers** so each spec controls clear-ordering explicitly (mirrors the canonical `e2e/AC-AUTH-005.spec.ts`, which does `api.delete(...)` **before** the magic-link trigger, then polls):
  ```ts
  import { request as pwRequest, expect } from '@playwright/test';

  export const MAILPIT = 'http://127.0.0.1:54324';

  /** Clear the Mailpit inbox so the next poll reads the freshest message. Call this BEFORE the send/trigger
   *  action (button click / service-role invite), mirroring AC-AUTH-005.spec.ts (clear → trigger → poll). */
  export async function clearMailpit(): Promise<void> {
    const api = await pwRequest.newContext();
    try {
      await api.delete(`${MAILPIT}/api/v1/messages`);
    } catch {
      /* mailbox may already be empty */
    }
  }

  /** Poll Mailpit for the most recent auth email to `email` and return the first http(s) link in the body.
   *  Does NOT clear the inbox — call clearMailpit() before the trigger action. */
  export async function pollMailpitForAuthLink(email: string, timeout = 15_000): Promise<string> {
    const api = await pwRequest.newContext();
    let link: string | null = null;
    await expect
      .poll(
        async () => {
          const listRes = await api.get(`${MAILPIT}/api/v1/messages`);
          const list = await listRes.json();
          const msg = (list.messages ?? []).find((m: { To: { Address: string }[] }) =>
            m.To?.some((t) => t.Address === email));
          if (!msg) return false;
          const bodyRes = await api.get(`${MAILPIT}/api/v1/message/${msg.ID}`);
          const body = await bodyRes.json();
          const text: string = `${body.Text ?? ''}\n${body.HTML ?? ''}`;
          const match = text.match(/https?:\/\/[^\s"'<>]*(?:verify|token|magiclink|otp|recovery|reset)[^\s"'<>]*/i);
          link = match ? match[0].replace(/&amp;/g, '&') : null;
          return Boolean(link);
        },
        { timeout, intervals: [500, 1000, 1500] }
      )
      .toBeTruthy();
    return link!;
  }
  ```
  *(Split rationale: a single helper that clears inside `pollMailpitForAuthLink` wipes the message under test when the poll runs AFTER the trigger — both AC-AUTHF-005 and AC-AUTHF-020 would time out. Each spec clears BEFORE its trigger, then polls. Pure addition — `AC-AUTH-005.spec.ts` keeps its own inline polling; the new specs use the two helpers.)*
- **Verify:** `cd pmo-portal && npx tsc --noEmit -p .` (or `npm run typecheck`) 0 errors.

### 6.2 (GREEN) e2e: AC-AUTHF-005 — password-reset email round-trips via Mailpit
- **File (new):** `pmo-portal/e2e/AC-AUTHF-005-password-reset.spec.ts`.
  ```ts
  import { test, expect, request } from '@playwright/test';
  import { MAILPIT, clearMailpit, pollMailpitForAuthLink } from './helpers';

  // AC-AUTHF-005 — password-reset round-trip via local Mailpit (FR-AUTHF-011/015/020/024).
  test('AC-AUTHF-005: request reset → Mailpit → /update-password → set password → signed in with the new password', async ({ page, browser }) => {
    const email = 'pm@acme.test';
    const newPassword = 'BrandNewPass1!';

    // 0. Clear Mailpit BEFORE the send action (mirrors AC-AUTH-005: clear → trigger → poll).
    await clearMailpit();

    // 1. Request the reset link.
    await page.goto('/reset-password');
    await page.getByLabel(/email/i).fill(email);
    await page.getByRole('button', { name: /send reset link/i }).click();
    await expect(page.getByRole('status')).toContainText(/check your email|reset link/i);

    // 2. Pull the link from Mailpit (inbox NOT cleared here) and follow it → /update-password set-password form.
    const link = await pollMailpitForAuthLink(email);
    expect(link).toMatch(/update-password|type=recovery|token=/i);
    await page.goto(link);
    await expect(page).toHaveURL(/\/update-password/);
    await expect(page.getByLabel(/new password/i)).toBeVisible();
    // FR-AUTHF-027: the token params were stripped from the URL after session establishment.
    await expect(page).not.toHaveURL(/[?&](token|refresh_token|type)=/);

    // 3. Set the new password → navigates to / signed in.
    await page.getByLabel(/new password/i).fill(newPassword);
    await page.getByLabel(/confirm password/i).fill(newPassword);
    await page.getByRole('button', { name: /set new password/i }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText('Diego Salvatierra')).toBeVisible(); // PM persona

    // 4. The NEW password works on a fresh context; the OLD one no longer does.
    const fresh = await browser.newContext();
    const p2 = await fresh.newPage();
    await p2.goto('/login');
    await p2.getByLabel(/email/i).fill(email);
    await p2.getByLabel(/password/i).fill(newPassword);
    await p2.getByRole('button', { name: /sign in/i }).click();
    await expect(p2).toHaveURL(/\/$/);
    await fresh.close();

    const fresh2 = await browser.newContext();
    const p3 = await fresh2.newPage();
    await p3.goto('/login');
    await p3.getByLabel(/email/i).fill(email);
    await p3.getByLabel(/password/i).fill('Passw0rd!dev'); // old password
    await p3.getByRole('button', { name: /sign in/i }).click();
    await expect(p3.getByRole('alert')).toBeVisible();
    await fresh2.close();
  });
  ```
- **Verify (local stack up):** `cd pmo-portal && npx playwright test e2e/AC-AUTHF-005-password-reset.spec.ts` green.

### 6.3 (GREEN) e2e: AC-AUTHF-020 — invite-acceptance round-trips; gate clears after set-password
- **File (new):** `pmo-portal/e2e/AC-AUTHF-020-invite-acceptance.spec.ts`. Setup stands in for GTM item 1a issuance via the service-role admin API.
  ```ts
  import { test, expect, skip } from '@playwright/test';
  import { createClient } from '@supabase/supabase-js';
  import { clearMailpit, pollMailpitForAuthLink } from './helpers';

  // AC-AUTHF-020 — invite-acceptance round-trip (FR-AUTHF-030/031/032/034/035). Test setup stands in for
  // GTM item 1a issuance: service-role inviteUserByEmail + user_metadata.invite_pending=true + a profiles
  // row. Honest boundary (D6): service-role key from process.env; skip cleanly when absent.
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
  const ANON = process.env.VITE_SUPABASE_ANON_KEY ?? '';
  (SERVICE_ROLE_KEY ? test : test.skip)('AC-AUTHF-020: invite link → /update-password → set password → signed in; gate clears', async ({ page }) => {
    const email = `invitee-${Date.now()}@example.com`;
    const password = 'InvitePass1!';
    const orgId = '00000000-0000-0000-0000-000000000001'; // seed org

    // --- Stand in for GTM item 1a issuance (service-role admin API) ---
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, { auth: { persistSession: false }});

    // 0. Clear Mailpit BEFORE the invite trigger (mirrors AC-AUTH-005: clear → trigger → poll). The invite
    //    email is the message under test — clearing inside the poll would wipe it.
    await clearMailpit();

    const { data: inviteData, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { invite_pending: true }, // §1.2 INVITE_PENDING contract (item 1a → this issue)
    });
    expect(inviteErr).toBeNull();
    const userId = inviteData!.user.id;
    // matching profiles row carrying role + org_id (§1.2 handshake)
    const { error: profileErr } = await admin.from('profiles').insert({
      id: userId, org_id: orgId, role: 'Project Manager', full_name: 'Invitee Test',
      email, company_id: null, avatar_url: null, title: null, location: null, skills: [], utilization: null,
    });
    expect(profileErr).toBeNull();
    try {
      // --- Acceptance surface (this issue) ---
      const link = await pollMailpitForAuthLink(email);
      await page.goto(link);
      await expect(page).toHaveURL(/\/update-password/);
      await expect(page.getByLabel(/new password/i)).toBeVisible();
      await page.getByLabel(/new password/i).fill(password);
      await page.getByLabel(/confirm password/i).fill(password);
      await page.getByRole('button', { name: /set new password/i }).click();
      await expect(page).toHaveURL(/\/$/);                 // FR-AUTHF-024/031
      // FR-AUTHF-035: the success updateUser cleared invite_pending → gate does NOT bounce a reload to /.
      await page.reload();
      await expect(page).toHaveURL(/\/$/);
      await expect(page).not.toHaveURL(/\/update-password/);
    } finally {
      // cleanup the test user + profile (service-role)
      await admin.from('profiles').delete().eq('id', userId);
      await admin.auth.admin.deleteUser(userId);
    }
  });
  ```
  *(Notes: (a) `test.skip`-as-decorator — if the Playwright version prefers `test.fixme`/conditional, use `if (!SERVICE_ROLE_KEY) test.skip();` at the top of the body instead. (b) The runbook (Slice 5) documents that the developer exports `SUPABASE_SERVICE_ROLE_KEY` from `supabase status` before running this spec; CI sets it from `supabase status --output json`.)*
- **Verify (local stack up + `SUPABASE_SERVICE_ROLE_KEY` exported):**
  ```bash
  export SUPABASE_SERVICE_ROLE_KEY="$(supabase status --output json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).serviceRole))")"
  cd pmo-portal && npx playwright test e2e/AC-AUTHF-020-invite-acceptance.spec.ts
  ```
  green. Without the env var, the spec reports `skipped` (not failed) — the honest boundary. Slice 6 complete.

---

## Phase 7 — Full-suite gate (binding pre-push)

### 7.1 (GREEN) Whole-suite verify + targeted e2e
- **Verify (from `pmo-portal/`):**
  ```bash
  npm run verify            # = typecheck && lint:ci && test && build  (mirrors CI's verify job)
  npx playwright test e2e/AC-AUTHF-005-password-reset.spec.ts e2e/AC-AUTHF-020-invite-acceptance.spec.ts e2e/AC-AUTH-005.spec.ts
  ```
  - `npm run typecheck` → 0 errors.
  - `npm run lint:ci` → 0 warnings (`--max-warnings=0`).
  - `npm test` → all Vitest green (incl. the 5 new/edited test files: `events.test.ts`, `AuthProvider.test.tsx`, `ResetPasswordPage.test.tsx`, `UpdatePasswordPage.test.tsx`, `RequireInviteAccepted.test.tsx`, `LoginPage.test.tsx` (edited), `authPagesNoDemo.test.tsx`, `authRedirects.test.tsx`, `authFloorAnalytics.test.tsx`).
  - `npm run build` → succeeds.
  - The 3 e2e specs green (AC-AUTHF-005, AC-AUTHF-020 with the service-role key exported, and the existing AC-AUTH-005 regression).
- **Binding note:** run the WHOLE `npm run verify`, not just touched files — a change to the shared `authFormPrimitives` / `AuthContext` seam can silently break every other test that renders auth. Targeted runs are for the inner TDD loop only.

---

## Traceability (every AC → exactly one owning test layer + file + task)

> ADR-0010: one owning layer per AC. `grep -r AC-AUTHF-###` finds each AC's proof at its owning layer. **No
> pgTAP-owned AC** — this issue adds no migration/RLS (NFR-AUTHF-SEC-003). Config-runbook acceptance is
> **separate** (§7, owner-gated, per-client) — not in the automatable AC battery.

| AC | Layer | Owning file | Task(s) | FR/NFR |
|---|---|---|---|---|
| **AC-AUTHF-001** | Unit (RTL) | `src/auth/ResetPasswordPage.test.tsx` | 1.1, 1.5, 1.6 | FR-AUTHF-010/060; NFR-AUTHF-UX-001 |
| **AC-AUTHF-002** | Unit (RTL) | `src/auth/ResetPasswordPage.test.tsx` | 1.2, 1.5 | FR-AUTHF-011/015/050 |
| **AC-AUTHF-003** | Unit (RTL) | `src/auth/ResetPasswordPage.test.tsx` | 1.3, 1.5 | FR-AUTHF-012/013; NFR-AUTHF-SEC-001 |
| **AC-AUTHF-004** | Unit (RTL) | `src/auth/ResetPasswordPage.test.tsx` | 1.4, 1.5 | FR-AUTHF-014; NFR-AUTHF-REL-001 |
| **AC-AUTHF-005** | E2E (Playwright) | `e2e/AC-AUTHF-005-password-reset.spec.ts` | 6.1, 6.2 | FR-AUTHF-011/015/020/024 |
| **AC-AUTHF-010** | Unit (RTL) | `src/auth/UpdatePasswordPage.test.tsx` | 2.1, 2.8 | FR-AUTHF-020; NFR-AUTHF-UX-001 |
| **AC-AUTHF-011** | Unit (RTL) | `src/auth/UpdatePasswordPage.test.tsx` | 2.2, 2.8 | FR-AUTHF-022 |
| **AC-AUTHF-012** | Unit (RTL) | `src/auth/UpdatePasswordPage.test.tsx` | 2.3, 2.8 | FR-AUTHF-022/026/035/061 |
| **AC-AUTHF-013** | Unit (RTL) | `src/auth/UpdatePasswordPage.test.tsx` | 2.4, 2.8 | FR-AUTHF-024; NFR-AUTHF-REL-003 |
| **AC-AUTHF-014** | Unit (RTL) | `src/auth/UpdatePasswordPage.test.tsx` | 2.5, 2.8 | FR-AUTHF-025 |
| **AC-AUTHF-015** | Unit (RTL) | `src/auth/UpdatePasswordPage.test.tsx` | 2.6, 2.8 | FR-AUTHF-002/021; NFR-AUTHF-REL-002 |
| **AC-AUTHF-016** | Unit (router/RTL) | `src/auth/RequireInviteAccepted.test.tsx` | 3.1, 3.2, 3.3 | FR-AUTHF-034; D-AUTHF-14 |
| **AC-AUTHF-017** | Unit (RTL) | `src/auth/UpdatePasswordPage.test.tsx` | 2.7, 2.8 | FR-AUTHF-027; NFR-AUTHF-SEC-002 |
| **AC-AUTHF-020** | E2E (Playwright) | `e2e/AC-AUTHF-020-invite-acceptance.spec.ts` | 6.1, 6.3 | FR-AUTHF-030/031/032/034/035 |
| **AC-AUTHF-025** | Unit (RTL) | `src/auth/LoginPage.test.tsx` | 4.1, 4.4 | FR-AUTHF-040/043 |
| **AC-AUTHF-026** | Unit (RTL) | `src/auth/LoginPage.test.tsx` | 4.2, 4.4 | FR-AUTHF-041/050 |
| **AC-AUTHF-027** | Unit (RTL) | `src/auth/LoginPage.test.tsx` | 4.3, 4.4 | FR-AUTHF-042; NFR-AUTHF-UX-001 |
| **AC-AUTHF-030** | Unit (RTL) | `src/auth/authRedirects.test.tsx` | 4.5 | FR-AUTHF-050; NFR-AUTHF-SEC-004 |
| **AC-AUTHF-035** | Unit (RTL) | `src/auth/authPagesNoDemo.test.tsx` | 2.10 | FR-AUTHF-060; D-AUTHF-9 |
| **AC-AUTHF-036** | Unit (RTL) | `src/auth/authFloorAnalytics.test.tsx` | 4.6 | FR-AUTHF-061; NFR-AUTHF-OBS-001/SEC-002 |

**Self-verify (every AC placed exactly once):** 20 ACs — 001, 002, 003, 004, 005, 010, 011, 012, 013, 014, 015,
016, 017, 020, 025, 026, 027, 030, 035, 036. Each appears in exactly one row above. 18 unit/RTL-owned + 2
e2e-owned (005 reset round-trip, 020 invite round-trip — the only genuine cross-stack flows; the rest are
client state/redirect/analytics, correctly unit-owned per ADR-0010). The config runbook (NFR-AUTHF-CONF-001…008)
is delivered as `docs/environments.md` (task 5.2) + the `config.toml` opt-in (task 5.1), owner-gated per client —
**not** in the AC battery (spec §7).

**Task count: 29** — Phase 0 (0.1, 0.2, 0.3, 0.4) · Slice 1 (1.1–1.6) · Slice 2 (2.1–2.10) · Slice 3 (3.1–3.3)
· Slice 4 (4.1–4.6) · Slice 5 (5.1, 5.2) · Slice 6 (6.1–6.3) · Phase 7 (7.1).

---

## Open questions for the Director

1. **config.toml SMTP block — commented vs active (D5).** Spec §7.1a illustrates the `[auth.email.smtp]` block
   as active TOML, but binding §1.3 ("local dev stays as-is") + the e2e dependency on Mailpit (:54324) mean
   enabling it locally routes mail away from Inbucket and breaks `AC-AUTH-005`/`AC-AUTHF-005`/`AC-AUTHF-020`.
   This plan commits the block **commented** (with the `env(RESEND_API_KEY)` template) + activates only
   `auto_expose_new_tables=false`. Confirm the commented treatment is acceptable (it preserves the binding
   "local stays as-is" and the e2e boundary). If the owner wants active local SMTP, the tradeoff is a
   separate Inbucket-vs-Resend switch in the e2e — out of scope here.
2. **AC-AUTHF-020 service-role key access.** The invite e2e reads `process.env.SUPABASE_SERVICE_ROLE_KEY`
   and `test.skip`s when absent. Confirm (a) the env-var name, (b) that the developer/CI export-from-`supabase
   status` workflow is the intended mechanism (vs. a Playwright global-setup that shells out — flakier), and
   (c) that CI for `main` (which runs e2e per the branch-flow gates) will have the key available so the spec
   runs rather than skips in CI.
3. **`UpdatePasswordPage` "params + session but no `PASSWORD_RECOVERY` event" path.** Unreachable in practice
   (real recovery/invite links always emit the event; `detectSessionInUrl` does not strip the URL so
   `hasRecoveryParams` is true on mount). The page defensively holds at `verifying` (spinner) rather than
   wrongly showing `expired` on a real reset. Acceptable? (Alternative: extend the AuthContext seam to expose
   the last event — bigger change, spec-sanctioned but unnecessary given the URL-param gate.)
4. **Reset-success analytics.** FR-AUTHF-061 says the new flows call the existing auth-event builders.
   `trackAuthLoginSucceeded('password_reset')` is emitted by `UpdatePasswordPage` on a successful **set**
   (not by the `/reset-password` request page, which is not a login). AC-AUTHF-036's test reflects this. Confirm
   this reading (a reset-request is not itself a login success).
5. **`InvitePass1!` / `BrandNewPass1!` test passwords** meet the local policy (`>=10`, `lower_upper_letters_digits`).
   Confirm the seed's `minimum_password_length=10` is not tightened on the cloud project beyond these lengths
   (the runbook says "≥ local template").

PLAN-FIX-DONE
