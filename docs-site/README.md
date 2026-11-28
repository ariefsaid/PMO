# PMO docs site

The user guide as a website, built with [Starlight](https://starlight.astro.build) (Astro).

**Write pages in `docs/user-guide/`, not here.** `npm run sync` (run automatically before `dev`
and `build`) copies them into `src/content/docs/` (gitignored): each page's first `# Heading`
becomes its title, and relative `.md` links become site links. The sidebar groups are in
`astro.config.mjs`; a new page in an existing folder shows up on its own, while a new folder needs
a line there.

```
npm ci          # lock was generated on Linux; regenerate it only in a node:22 container
npm run dev     # http://localhost:4321
npm run build   # static site in dist/
npm test        # converter tests
```

⚑ This repo is public, and so is everything this site publishes. Keep it to user-facing guides.

## Cloudflare Pages setup (owner does this)

Pages → Create project → connect the repo:

- Root directory: `docs-site`
- Build command: `npm run build`
- Build output directory: `dist`
- Environment variable: `NODE_VERSION` = `22`
- Custom domain: e.g. `docs.pmo-portal.com`

The build reads `../docs/user-guide`, so the project needs the whole repo checkout (the default).
