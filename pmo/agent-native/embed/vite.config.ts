/**
 * Step 4 coexistence pilot — Vite config.
 *
 * Serves the embed shell from `embed/` and proxies the agent panel's same-origin
 * `/_agent-native/*` calls to the Nitro sidecar on 127.0.0.1:8100. The Vite dev
 * proxy forwards request headers — including `Authorization` — by default for
 * `changeOrigin: true` proxies; `configure` adds `x-agent-native-embed-target`
 * passthrough defensively (agent-native's interceptor sets it on same-origin
 * fetches). This keeps the embed same-origin so the browser sends the JWT the
 * interceptor injected.
 *
 * Run with:  npx vite --config embed/vite.config.ts
 * (port 5173). The Nitro sidecar must already be up on 8100 (`npm run dev`).
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  // The React/agent-native peer deps resolve from the sidecar root.
  resolve: {},
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/_agent-native": {
        target: "http://127.0.0.1:8100",
        changeOrigin: true,
        // Authorization forwards by default for changeOrigin proxies; this
        // just documents the intent and is a no-op safety net for any
        // intermediary that strips headers.
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req) => {
            // Preserve the Authorization header agent-native's fetch interceptor
            // injected on the client. (http-proxy keeps it by default; this is
            // belt-and-suspenders.)
            const auth = req.headers["authorization"];
            if (auth) proxyReq.setHeader("Authorization", auth);
            const target = req.headers["x-agent-native-embed-target"];
            if (target) proxyReq.setHeader("x-agent-native-embed-target", target);
          });
        },
      },
    },
  },
});
