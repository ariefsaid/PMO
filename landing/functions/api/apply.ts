// Cloudflare Pages Function: POST /api/apply
// Stores each design-partner application as JSON in the KV namespace bound as APPLICATIONS.

export interface KVLike {
  put(key: string, value: string): Promise<void>;
}
export interface Env {
  APPLICATIONS: KVLike;
}

const SIZES = ['', '1-20', '21-50', '51-200', '200+'];
const BUILDS = ['', 'construction', 'epc-energy', 'engineering-services', 'other'];
const MIN_FILL_MS = 3000;
const MAX_BODY = 20_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const json = (body: object, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export async function handleApply(request: Request, env: Env, now = Date.now()): Promise<Response> {
  const raw = await request.text();
  if (raw.length > MAX_BODY) return json({ ok: false, error: 'Request too large.' }, 413);
  let b: Record<string, unknown>;
  try {
    b = JSON.parse(raw);
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new Error('shape');
  } catch {
    return json({ ok: false, error: 'Invalid request.' }, 400);
  }

  // Bots: a filled honeypot or a too-fast submit looks like success and stores nothing.
  const started = Number(b.started);
  if (str(b.website) || !Number.isFinite(started) || now - started < MIN_FILL_MS) {
    return json({ ok: true });
  }

  const d = {
    name: str(b.name),
    email: str(b.email),
    company: str(b.company),
    role: str(b.role),
    phone: str(b.phone),
    size: str(b.size),
    business: str(b.business),
    fix: str(b.fix),
    consent: b.consent === true,
  };

  const fields: Record<string, string> = {};
  const need = (k: 'name' | 'company' | 'role', max: number, label: string) => {
    if (!d[k]) fields[k] = `Enter ${label}.`;
    else if (d[k].length > max) fields[k] = `Keep this under ${max} characters.`;
  };
  need('name', 100, 'your name');
  need('company', 150, 'your company');
  need('role', 100, 'your role');
  if (!d.email) fields.email = 'Enter your work email.';
  else if (d.email.length > 254 || !EMAIL.test(d.email)) fields.email = 'Enter a valid email address.';
  if (d.phone.length > 40) fields.phone = 'Keep this under 40 characters.';
  if (!SIZES.includes(d.size)) fields.size = 'Choose one of the listed sizes.';
  if (!BUILDS.includes(d.business)) fields.business = 'Choose one of the listed options.';
  if (d.fix.length > 2000) fields.fix = 'Keep this under 2000 characters.';
  if (!d.consent) fields.consent = 'Tick this box so we can reply to you.';

  if (Object.keys(fields).length) {
    return json({ ok: false, error: 'Please check the highlighted fields.', fields }, 422);
  }

  const id = crypto.randomUUID().slice(0, 8);
  const key = `${new Date(now).toISOString()}-${id}`;
  try {
    await env.APPLICATIONS.put(key, JSON.stringify({ ...d, received: new Date(now).toISOString() }));
  } catch {
    return json({ ok: false, error: 'Could not save your application. Please try again.' }, 500);
  }
  return json({ ok: true });
}

export const onRequestPost = ({ request, env }: { request: Request; env: Env }) =>
  handleApply(request, env);

export const onRequest = () => json({ ok: false, error: 'Method not allowed.' }, 405);
