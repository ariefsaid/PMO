# PMO Portal landing page

One static page for `pmo-portal.com`: "coming soon", with a design-partner application form.
Plain HTML and CSS, a small `app.js`, no framework, no build step, no tracking.

```
landing/
  index.html  styles.css  app.js
  assets/                      fonts, favicon, OG image, showreel video + posters
  functions/api/apply.ts       Pages Function: POST /api/apply
  functions/api/apply.test.ts  node --test
  _headers                     security headers and asset caching
```

## Cloudflare Pages setup (owner does this)

1. Pages → Create project → connect the repo (or direct upload of the `landing/` folder).
2. Settings:
   - Project name: `pmo-landing`
   - Production branch: as chosen by the owner
   - Root directory: `landing`
   - Build command: none (leave empty)
   - Build output directory: `.`
3. Workers KV: create a namespace (any name), then Pages project → Settings → Functions →
   KV namespace bindings → add variable name **`APPLICATIONS`** pointing at it (Production, and Preview if wanted).
   There are no secrets and no other environment variables.
4. Custom domains: add `pmo-portal.com` and `www.pmo-portal.com`. Redirect `www` to the apex if preferred.
5. Redeploy after adding the binding (bindings apply to the next deployment).

Each application is stored as JSON under the key `<ISO timestamp>-<8 hex id>`, for example
`2026-11-06T09:30:12.345Z-1a2b3c4d`. Read them in the dashboard (KV → namespace → entries) or with
`wrangler kv key list --binding APPLICATIONS` and `wrangler kv key get`.
Applications contain personal data: keep the namespace private.

## The form endpoint

`POST /api/apply` with JSON `{name, email, company, role, phone, size, business, fix, consent, website, started}`.
Returns `{ok:true}` or `{ok:false, error, fields?}` (422 for field errors, with a message per field).

- Server-side validation: required name, work email, company, role and consent; email format; length caps;
  `size` and `business` must be one of the listed options.
- Spam: the hidden `website` field (honeypot) and a minimum fill time of 3 s (`started` is the page-load
  time in ms). Both are rejected silently: the response is `{ok:true}` and nothing is stored.
- Bodies over 20 kB are refused. No secrets in code.

## Tests

```
node --test landing/functions/api/apply.test.ts      # Node 22.18+
```

Covers valid input, missing fields, a bad email, length caps, the honeypot, the minimum fill time and
malformed JSON.

## Local preview

```
cd landing && python3 -m http.server 8791     # page only; /api/apply needs `wrangler pages dev .` with a KV binding
```

## Content rules

- Public repo: no client names, no secrets, no emails other than the role address `hello@pmo-portal.com`.
- No pricing anywhere. Only claims that are true of shipped code; roadmap items say "on the roadmap".
- Screens in the page are simplified views on sample data and are captioned as such.
