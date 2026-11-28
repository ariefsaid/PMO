# Prove startup single-read (branch perf/1129-startup-single-read @ aa6c13e78, merged with origin/dev, no conflicts)

Sandbox: Docker, local Supabase stack, supabase db reset. DB files changed (migration 2810, its rollback, pgTAP 2810).

## Step 4 — pgtap job (every step, CI order): ALL PASS
- Migration prefix collision check | exit=0 | 
- Financial statement script tests | exit=0 | # tests 20 # pass 20 # fail 0 
- Reset DB | exit=0 | 
- Project short-name migration round trip | exit=0 | 
- Isolation denominator guard self-test | exit=0 | 
- Isolation denominator guard | exit=0 | 
- Schema registration scratch proof | exit=0 | # tests 1 # pass 1 # fail 0 
- Isolation proof self-test | exit=0 | 
- Anon-definer inventory | exit=0 | 
- pgTAP supabase test db (all) | exit=0 | Files=1179, Tests=29324, 450 wallclock secs ( 6.97 usr  1.84 sys + 11.41 cusr  7.04 csys = 27.26 CPU) Result: PASS 
- Receiving rollback proof | exit=0 | Files=1, Tests=7,  0 wallclock secs ( 0.01 usr +  0.01 sys =  0.02 CPU) Result: PASS 
- Isolation proof read+write | exit=0 | 
- Capture rollback harness | exit=0 | Files=1, Tests=46,  1 wallclock secs ( 0.03 usr  0.00 sys +  0.02 cusr  0.02 csys =  0.07 CPU) Result: PASS 
- Assignment rollback harness | exit=0 | Files=1, Tests=5,  0 wallclock secs ( 0.01 usr  0.01 sys +  0.01 cusr  0.00 csys =  0.03 CPU) Result: PASS 
- 2277 order-family rollback proof | exit=0 | Files=1, Tests=7,  0 wallclock secs ( 0.02 usr  0.00 sys +  0.01 cusr  0.00 csys =  0.03 CPU) Result: PASS 
- Undo kind-order rollback harness | exit=0 | Files=1, Tests=4,  0 wallclock secs ( 0.02 usr  0.00 sys +  0.01 cusr  0.00 csys =  0.03 CPU) Result: PASS 
- Contract quantities rollback harness | exit=0 | Files=1, Tests=5,  0 wallclock secs ( 0.01 usr  0.01 sys +  0.01 cusr  0.01 csys =  0.04 CPU) Result: PASS 
- Plans feature-enforcement rollback harness | exit=0 | Files=1, Tests=7,  1 wallclock secs ( 0.01 usr  0.02 sys +  0.04 cusr  0.03 csys =  0.10 CPU) Result: PASS 
- Plans limit rollback harness | exit=0 | Files=1, Tests=9,  0 wallclock secs ( 0.02 usr +  0.01 sys =  0.03 CPU) Result: PASS 
- Watermarks per-org rollback harness | exit=0 | Files=1, Tests=16,  0 wallclock secs ( 0.01 usr  0.01 sys +  0.01 cusr  0.00 csys =  0.03 CPU) Result: PASS 
- Stock posting rollback harness | exit=0 | Files=1, Tests=8,  0 wallclock secs ( 0.02 usr  0.00 sys +  0.00 cusr  0.01 csys =  0.03 CPU) Result: PASS 
- Stock posting two-session race | exit=0 | 
- Stock connect rollback harness | exit=0 | 
- Stock connect two-session race | exit=0 | # tests 1 # pass 1 # fail 0 
- AI credit allocation race | exit=0 | # tests 4 # pass 4 # fail 0 
- Fiscal year ensure script tests | exit=0 | # tests 2 # pass 2 # fail 0 
