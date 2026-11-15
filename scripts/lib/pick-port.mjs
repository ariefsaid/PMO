#!/usr/bin/env node
// pick-port.mjs — print `preferred` when it is free on localhost, else a free OS-assigned port (#1862).
// Local GoTrue only redirects to localhost:3000 (supabase/config.toml), so 3000 stays the default
// and a random port is the fallback for when another worktree's server holds it.
//   node scripts/lib/pick-port.mjs [preferred=3000] [avoid...]
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const listenOnce = (port) =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(null));
    s.listen(port, () => {
      const got = s.address().port;
      s.close(() => resolve(got));
    });
  });

export async function pickPort(preferred = 3000, avoid = []) {
  if (!avoid.includes(preferred) && (await listenOnce(preferred)) === preferred) return preferred;
  for (;;) {
    const p = await listenOnce(0);
    if (p !== null && !avoid.includes(p)) return p;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [pref, ...avoid] = process.argv.slice(2).map(Number);
  console.log(await pickPort(pref || 3000, avoid));
}
