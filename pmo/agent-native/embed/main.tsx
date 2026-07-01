/**
 * Step 4 coexistence pilot — React entry.
 *
 * Mounts:
 *   QueryClientProvider
 *     └─ <AgentSidebar position="right" defaultOpen>   ← from @agent-native/core/client
 *          └─ <MockPmoShell/>                          ← host app content (children)
 *
 * That wrapper ordering IS the coexistence question: does the host shell render
 * intact inside the sidebar wrapper, with the panel docking over the right edge
 * instead of reflowing/capturing the children?
 *
 * Auth: a minimal sign-in form mints a Supabase JWT via the password grant
 * (`embed/auth.ts`) and publishes it where agent-native's fetch interceptor
 * picks it up, so every same-origin `/_agent-native/*` call the panel makes is
 * auto-authorized through the Vite proxy → Nitro sidecar.
 *
 * No real ANTHROPIC_API_KEY is set in this pilot, so the LLM loop will not
 * actually answer — that's expected. We're proving embed + proxy + auth
 * handoff, i.e. the panel reaches the deputy action through the proxy.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  AgentSidebar,
  createAgentNativeQueryClient,
} from "@agent-native/core/client";

import { MockPmoShell } from "./mock-pmo";
import { SignInGate, useAuthBoot } from "./sign-in";
import "./shell.css";

const queryClient = createAgentNativeQueryClient();

function App(): React.JSX.Element {
  // Re-hydrate any token stored earlier this tab and install the fetch
  // interceptor before the panel's first same-origin call.
  useAuthBoot();

  return (
    <QueryClientProvider client={queryClient}>
      {/* SignInGate renders the password form until a JWT is published; once
          signed in, it renders the sidebar-wrapped host shell. */}
      <SignInGate>
        <AgentSidebar
          position="right"
          defaultOpen={true}
          emptyStateText="Ask about PMO companies or activities (LLM loop is off — no ANTHROPIC_API_KEY in this pilot)."
          suggestions={[
            "List my companies",
            "Summarize open projects",
            "Log a follow-up call",
          ]}
        >
          {/* The host app content goes INSIDE the sidebar — this is the
              coexistence probe. */}
          <MockPmoShell />
        </AgentSidebar>
      </SignInGate>
    </QueryClientProvider>
  );
}

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Step 4 pilot: #root element missing in embed/index.html");
}
createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
