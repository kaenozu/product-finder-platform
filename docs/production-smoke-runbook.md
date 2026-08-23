# Production readiness and smoke runbook

## Scope

This runbook separates **deploy**, **data readiness**, and **user-flow acceptance**. A successful deploy is not a successful release until the checks below pass against the same SHA and the same Pages/Worker/D1 resources.

No step in this document writes Production D1, publishes a catalog, changes Secrets, or changes cron configuration without explicit approval.

## Before deploy (read-only)

1. Confirm repository and default branch:
   - repository: `kaenozu/product-finder-platform`
   - default branch: `main`
   - record `git rev-parse origin/main`
2. Confirm the exact deploy SHA is the current `origin/main` HEAD.
3. Confirm the target Pages project, cron Worker, and D1 database names from the checked-in Wrangler configuration and GitHub Environment. Do not infer them from a local `.env`.
4. Check migration state with the provider's read-only migration/status command. Do not use `--remote --command` with INSERT/UPDATE/DELETE in this gate.
5. Record the rollback pair:
   - application rollback SHA
   - active catalog version ID and status

Catalog rollback is executed with the dedicated CLI (dry-run by default):

```bash
pnpm db:rollback -- --category rice-cooker --version <version_id> --execute
```

## Cron trigger read-back

After deploying the cron Worker, verify the trigger configuration:

```bash
# Production cron trigger の read-back
wrangler triggers list --config wrangler.cron.jsonc
```

Expected output:

- Trigger: `0 3 * * *` (UTC 03:00 = JST 12:00 noon)

If the trigger differs from `wrangler.cron.jsonc`, do not proceed with the release. The cron schedule must match the checked-in configuration.

## Deploy gate

The deploy workflow must verify the exact SHA, run build/quality checks, and fail closed if the expected SHA is not the default branch HEAD. A deploy run with no post-deploy report is **not verified**.

## Post-deploy smoke

Run the script against the deployed public URL:

```bash
node scripts/production-smoke.mjs \
  --base-url https://pitariko.pages.dev \
  --category rice-cooker \
  --mode match \
  --answers '{"cookVolume":"2","heating":"pressure_ih","budget":"10to20k","priority":"taste","installWidth":"free"}'
```

The script checks:

- `/api/health` returns 200
- `/api/ready` returns 200 and `ok=true`
- `/api/config` returns the requested category and questions
- diagnosis returns at least one candidate for the match fixture
- no-match fixture can be run with `--mode no-match`
- `/go/` is checked only when an active-offer URL/token is explicitly supplied

The output is a privacy-safe JSON summary. It does not print product catalog contents, API keys, tokens, or secrets.

## Required acceptance evidence

Record the following in the deploy evidence issue:

- expected/deployed application SHA
- Pages/Worker/D1 resource identifiers (names only)
- migration status (read-only)
- active catalog version ID/status and product/offer counts (read-only)
- smoke output for match and no-match fixtures
- `/go/` status if an active offer exists; otherwise `NOT_EXECUTED: no active offer token`
- UI smoke: home → diagnosis → result, including one-question, two-question, back/edit, and stale-result checks
- rollback SHA and active catalog version rollback target

## Failure states

- deploy succeeded but readiness failed: `DEPLOYED_UNVERIFIED`
- readiness succeeded but diagnosis match failed: `CATALOG_OR_CONTRACT_FAILURE`
- match succeeded but no-match fixture failed: `DIAGNOSIS_GATE_FAILURE`
- `/go/` not run because no active offer exists: `NOT_EXECUTED`, never PASS
- any failed gate: do not announce release or claim Production acceptance
