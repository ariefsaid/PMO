# Browser part c3 (chromium shard 3/3) - FINAL

Source: tmp/1129-prove-all @ 4f6cceffd. Fresh local Supabase stack (db reset), env as CI step "Write .env.local", app served by Playwright webServer (no edge functions served; CI browser job does not either). Command: `npx playwright test --project=chromium --shard=3/3 --reporter=list`, config retries (0 in this config, so no flaky classification possible).

| Planned | Passed | Failed | Skipped | Flaky | Wall |
|---|---|---|---|---|---|
| 227 (41 files) | 204 | 21 | 2 | 0 | 18.2 min (1093 s) |

## Re-run alone (each failed test once, retries=0)
All 21 failed again alone (about 45-100 s each). None is load-sensitive in this sandbox: all are real here.

## Pattern
18 of 21 fail at the same assertion: `expect(html).toHaveAttribute("lang","id")` receives `"en"` (5 s timeout; 60 s in AC-BWO-004). Every one is a Bahasa Indonesia (id) layout test, and the page stays in English. The 3 others are also Bahasa tests: 2 cannot find expected Bahasa text, 1 times out. Every Bahasa layout test in this shard fails and no English one does, so the Bahasa locale is never applied in this run. Cause not diagnosed (trace not inspected beyond the error lines).

## Failures (spec, test, step, first lines of error)

### e2e/layout/dashboard.layout.spec.ts:45
@layout AC-FAA-010: long Indonesian money values stay fully visible in Executive KPI tiles at desktop and phone widths
```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('region', { name: 'Angka perusahaan' }).getByText('Kontrak berjalan · di luar pajak', { exact: true }).locator('../..')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByRole('region', { name: 'Angka perusahaan' }).getByText('Kontrak berjalan · di luar pajak', { exact: true }).locator('../..')

```

### e2e/support/figure-layout.ts:153
@layout AC-RD-GEOM-001: executive dashboard at 1440px (Bahasa)
```
Error: expect(locator).toHaveAttribute(expected) failed

Locator:  locator('html')
Expected: "id"
Received: "en"
Timeout:  5000ms

Call log:
  - Expect "toHaveAttribute" with timeout 5000ms
  - waiting for locator('html')
    11 × locator resolved to <html lang="en">…</html>
       - unexpected value "en"

```

### e2e/support/figure-layout.ts:153
@layout AC-RD-GEOM-001: executive dashboard at 390px (Bahasa)
```
Error: expect(locator).toHaveAttribute(expected) failed

Locator:  locator('html')
Expected: "id"
Received: "en"
Timeout:  5000ms

Call log:
  - Expect "toHaveAttribute" with timeout 5000ms
  - waiting for locator('html')
    12 × locator resolved to <html lang="en">…</html>
       - unexpected value "en"

```

### e2e/support/figure-layout.ts:153
@layout AC-RD-GEOM-001: finance dashboard at 1440px (Bahasa)
```
Error: expect(locator).toHaveAttribute(expected) failed

Locator:  locator('html')
Expected: "id"
Received: "en"
Timeout:  5000ms

Call log:
  - Expect "toHaveAttribute" with timeout 5000ms
  - waiting for locator('html')
    10 × locator resolved to <html lang="en">…</html>
       - unexpected value "en"

```

### e2e/layout/financial-statements.layout.spec.ts:45
@layout AC-008 support: company native trial balance fits at 390px in id/light
```
Error: expect(locator).toHaveAttribute(expected) failed

Locator:  locator('html')
Expected: "id"
Received: "en"
Timeout:  5000ms

Call log:
  - Expect "toHaveAttribute" with timeout 5000ms
  - waiting for locator('html')
    13 × locator resolved to <html lang="en">…</html>
       - unexpected value "en"

```

### e2e/layout/financial-statements.layout.spec.ts:45
@layout AC-008 support: company native trial balance fits at 390px in id/dark
```
Error: expect(locator).toHaveAttribute(expected) failed

Locator:  locator('html')
Expected: "id"
Received: "en"
Timeout:  5000ms

Call log:
  - Expect "toHaveAttribute" with timeout 5000ms
  - waiting for locator('html')
    13 × locator resolved to <html lang="en" class="dark">…</html>
       - unexpected value "en"

```

### e2e/layout/financial-statements.layout.spec.ts:45
@layout AC-008 support: company native trial balance fits at 1440px in id/light
```
Error: expect(locator).toHaveAttribute(expected) failed

Locator:  locator('html')
Expected: "id"
Received: "en"
Timeout:  5000ms

Call log:
  - Expect "toHaveAttribute" with timeout 5000ms
  - waiting for locator('html')
    12 × locator resolved to <html lang="en">…</html>
       - unexpected value "en"

```

### e2e/layout/financial-statements.layout.spec.ts:45
@layout AC-008 support: company native trial balance fits at 1440px in id/dark
```
Error: expect(locator).toHaveAttribute(expected) failed

Locator:  locator('html')
Expected: "id"
Received: "en"
Timeout:  5000ms

Call log:
  - Expect "toHaveAttribute" with timeout 5000ms
  - waiting for locator('html')
    13 × locator resolved to <html lang="en" class="dark">…</html>
       - unexpected value "en"

```

### e2e/layout/procurement-columns.layout.spec.ts:10
@layout #1791/#2497: at 1440px every column holds its text whole with no sideways scroll (id)
```
Error: expect(locator).toBeVisible() failed

Locator: locator('tbody').getByText('Material', { exact: true }).first()
Expected: visible
Timeout: 20000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 20000ms
  - waiting for locator('tbody').getByText('Material', { exact: true }).first()

```

### e2e/layout/procurement-files.layout.spec.ts:370
@layout AC-BUPOT-021 id 360px renders a recorded ledger and details
```
Error: expect(locator).toHaveAttribute(expected) failed

Locator:  locator('html')
Expected: "id"
Received: "en"
Timeout:  5000ms

Call log:
  - Expect "toHaveAttribute" with timeout 5000ms
  - waiting for locator('html')
    14 × locator resolved to <html lang="en">…</html>
       - unexpected value "en"

```

### e2e/layout/procurement-files.layout.spec.ts:370
@layout AC-BUPOT-021 id 1440px renders a recorded ledger and details
```
Error: expect(locator).toHaveAttribute(expected) failed

Locator:  locator('html')
Expected: "id"
Received: "en"
Timeout:  5000ms

Call log:
  - Expect "toHaveAttribute" with timeout 5000ms
  - waiting for locator('html')
    13 × locator resolved to <html lang="en">…</html>
       - unexpected value "en"

```

### e2e/layout/project-detail.layout.spec.ts:537
@layout AC-BWO-004: Bahasa Indonesia at 1024px and 1440px — Invoice is inside the list's visible box and nothing scrolls sideways
```
Error: expect(locator).toHaveAttribute(expected) failed

Locator:  locator('html')
Expected: "id"
Received: "en"
Timeout:  60000ms

Call log:
  - Expect "toHaveAttribute" with timeout 60000ms
  - waiting for locator('html')
    118 × locator resolved to <html lang="en">…</html>
        - unexpected value "en"

```

### e2e/layout/project-detail.layout.spec.ts:703
@layout AC-008 support: project totals fit at 390px in id/light
```
Error: expect(locator).toHaveAttribute(expected) failed

Locator:  locator('html')
Expected: "id"
Received: "en"
Timeout:  5000ms

Call log:
  - Expect "toHaveAttribute" with timeout 5000ms
  - waiting for locator('html')
    12 × locator resolved to <html lang="en">…</html>
       - unexpected value "en"

```

### e2e/layout/project-detail.layout.spec.ts:703
@layout AC-008 support: project totals fit at 390px in id/dark
```
Error: expect(locator).toHaveAttribute(expected) failed

Locator:  locator('html')
Expected: "id"
Received: "en"
Timeout:  5000ms

Call log:
  - Expect "toHaveAttribute" with timeout 5000ms
  - waiting for locator('html')
    12 × locator resolved to <html lang="en" class="dark">…</html>
       - unexpected value "en"

```

### e2e/layout/project-detail.layout.spec.ts:703
@layout AC-008 support: project totals fit at 1440px in id/light
```
Error: expect(locator).toHaveAttribute(expected) failed

Locator:  locator('html')
Expected: "id"
Received: "en"
Timeout:  5000ms

Call log:
  - Expect "toHaveAttribute" with timeout 5000ms
  - waiting for locator('html')
    10 × locator resolved to <html lang="en">…</html>
       - unexpected value "en"

```

### e2e/layout/project-detail.layout.spec.ts:703
@layout AC-008 support: project totals fit at 1440px in id/dark
```
Error: expect(locator).toHaveAttribute(expected) failed

Locator:  locator('html')
Expected: "id"
Received: "en"
Timeout:  5000ms

Call log:
  - Expect "toHaveAttribute" with timeout 5000ms
  - waiting for locator('html')
    11 × locator resolved to <html lang="en" class="dark">…</html>
       - unexpected value "en"

```

### e2e/support/figure-layout.ts:153
@layout AC-RD-GEOM-001: management pack dashboard at 1440px (Bahasa)
```
Error: expect(locator).toHaveAttribute(expected) failed

Locator:  locator('html')
Expected: "id"
Received: "en"
Timeout:  5000ms

Call log:
  - Expect "toHaveAttribute" with timeout 5000ms
  - waiting for locator('html')
    12 × locator resolved to <html lang="en">…</html>
       - unexpected value "en"

```

### e2e/support/figure-layout.ts:153
@layout AC-RD-GEOM-001: revenue by project dashboard at 1440px (Bahasa)
```
Error: expect(locator).toHaveAttribute(expected) failed

Locator:  locator('html')
Expected: "id"
Received: "en"
Timeout:  5000ms

Call log:
  - Expect "toHaveAttribute" with timeout 5000ms
  - waiting for locator('html')
    12 × locator resolved to <html lang="en">…</html>
       - unexpected value "en"

```

### e2e/layout/sales.layout.spec.ts:60
@layout AC-SBC-001: Bahasa Indonesia at 390px and 1440px — every card descendant stays inside the card and no card list scrolls sideways
```
Test timeout of 30000ms exceeded.
```

### e2e/layout/sales.layout.spec.ts:95
@layout AC-S24-004: phone identity, geometry, disclosure, and canonical activation in id/light
```
Error: expect(locator).toHaveAttribute(expected) failed

Locator:  locator('html')
Expected: "id"
Received: "en"
Timeout:  5000ms

Call log:
  - Expect "toHaveAttribute" with timeout 5000ms
  - waiting for locator('html')
    13 × locator resolved to <html lang="en">…</html>
       - unexpected value "en"

```

### e2e/layout/sales.layout.spec.ts:95
@layout AC-S24-004: phone identity, geometry, disclosure, and canonical activation in id/dark
```
Error: expect(locator).toHaveAttribute(expected) failed

Locator:  locator('html')
Expected: "id"
Received: "en"
Timeout:  5000ms

Call log:
  - Expect "toHaveAttribute" with timeout 5000ms
  - waiting for locator('html')
    13 × locator resolved to <html lang="en" class="dark">…</html>
       - unexpected value "en"

```

What the page showed: for the 18 lang failures, the app rendered in English (html lang="en"), not Bahasa. For AC-FAA-010 the Executive KPI region named "Angka perusahaan" (Bahasa) was not found, so the page was not in Bahasa. For #1791/#2497 the Bahasa "Material" cell was not in the table body within 20 s. AC-SBC-001 timed out at 30 s.

## Skipped
2 skipped (not itemised).
