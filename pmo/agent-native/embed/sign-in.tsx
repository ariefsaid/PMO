/**
 * Minimal sign-in gate — Step 4 coexistence pilot.
 *
 * Renders a tiny email/password form until a Supabase JWT is published via
 * `activateEmbedAuth`. Once signed in, renders `children` (the sidebar-wrapped
 * host shell). Intentionally bare: the coexistence question does not need a
 * polished auth UI, only a correct JWT to reach the deputy action.
 */
import React from "react";

import {
  activateEmbedAuth,
  clearEmbedAuth,
  hasStoredToken,
  signInWithPassword,
} from "./auth";

const SEED_EMAIL = "admin@acme.test";
const SEED_HINT = "Passw0rd!dev";

interface SignInGateProps {
  children: React.ReactNode;
}

export function SignInGate({ children }: SignInGateProps): React.JSX.Element {
  const [signedIn, setSignedIn] = React.useState<boolean>(hasStoredToken());
  const [email, setEmail] = React.useState<string>(SEED_EMAIL);
  const [password, setPassword] = React.useState<string>("");
  const [busy, setBusy] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { accessToken } = await signInWithPassword(email, password);
      activateEmbedAuth(accessToken);
      setSignedIn(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function handleSignOut(): void {
    clearEmbedAuth();
    setSignedIn(false);
  }

  if (signedIn) {
    return (
      <div className="pilot-signed-in">
        {children}
        <button
          type="button"
          className="pilot-signout"
          onClick={handleSignOut}
          title="Clear the stored embed token and show the sign-in form again."
        >
          Sign out (reset pilot)
        </button>
      </div>
    );
  }

  return (
    <div className="pilot-signin">
      <form className="pilot-signin__form" onSubmit={handleSubmit}>
        <h1 className="pilot-signin__title">PMO × agent-native pilot</h1>
        <p className="pilot-signin__sub">
          Sign in to publish a Supabase JWT the agent panel forwards to the
          sidecar via the Vite proxy. Seeded dev user is pre-filled.
        </p>

        <label className="pilot-field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            autoComplete="username"
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>

        <label className="pilot-field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            placeholder={SEED_HINT}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        {error ? <p className="pilot-error">{error}</p> : null}

        <button type="submit" className="pilot-submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>

        <p className="pilot-hint">
          Seeded user: <code>{SEED_EMAIL}</code> / <code>{SEED_HINT}</code>
        </p>
      </form>
    </div>
  );
}

/**
 * Install the embed-auth fetch interceptor on mount if a token is already
 * stored from a prior sign-in this tab. Ensures a reload re-activates auth
 * before the panel's first same-origin call.
 */
export function useAuthBoot(): void {
  React.useEffect(() => {
    if (hasStoredToken()) {
      // Re-publish + reinstall the interceptor. We don't have the raw token
      // here, but it's already in sessionStorage; activateEmbedAuth just needs
      // to ensure the interceptor is installed, which reads sessionStorage.
      activateEmbedAuth(sessionStorage.getItem("agent-native:embed-auth-token") ?? "");
    }
  }, []);
}
