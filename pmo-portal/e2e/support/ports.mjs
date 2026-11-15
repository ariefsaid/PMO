// #1862: the e2e app/consent ports come from the environment (defaults keep CI at 3000/3100).
export function portFromEnv(name, fallback, env = process.env) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`${name} must be a port number, got '${raw}'`);
  return n;
}
