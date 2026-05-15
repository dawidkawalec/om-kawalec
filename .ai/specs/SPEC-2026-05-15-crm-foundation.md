# SPEC-2026-05-15: CRM Foundation (Phase 1)

**Status:** in progress
**Driver:** PRD v0.1 — [`./PRD.md`](./PRD.md)
**Last updated:** 2026-05-16

## Overview

Bring up Open Mercato as Kawalec Agency's single source of truth for CRM (people, companies, deals, pipeline, activities) on the Hetzner VPS `kawalec-vps` behind `cc.kawalec.pl`. Migrate operational data from Twenty CRM, enable the built-in MCP server for AI clients (Claude Desktop / Claude Code / Cursor), document everything.

Phase 1 is **infrastructure + CRM only**. Support tickets, projects, time tracking, billing follow in Phases 2–5.

## Architecture corrections vs PRD v0.1

The PRD assumed `sales` module held deals and pipeline. Inspection of `@open-mercato/core@0.6.1` proved otherwise:

| PRD nomenclature | OM core reality |
|------------------|-----------------|
| `sales.Opportunity` | `customers.CustomerDeal` |
| Pipeline + Stages | `customers.CustomerPipeline` + `customers.CustomerPipelineStage` (per-pipeline, with `position`) |
| `tasks.Task` | `customers.CustomerTodoLink` (todos live inside customers, not a standalone module) |
| Sales module | Billing flow only: `SalesQuote → SalesOrder → SalesInvoice`, payments, shipments. Belongs to **Phase 5**. |

`pipeline_stage` dictionary (`customer_dictionary_entries.kind='pipeline_stage'`) is a **lookup for labels/colors/icons**, not the authoritative stage list. The Kanban UI at `/backend/customers/deals/pipeline` reads stages from `customer_pipeline_stages` and joins the dictionary by value for color/icon rendering.

Both tables must be kept in sync by any seed.

## Enabled modules (`src/modules.ts`)

From preset `crm` + manually added: `attachments`, `integrations`. Plus the project overlay `kawalec`.

```
auth · directory · configs · entities · query_index · api_docs · audit_logs
notifications · dashboards · events · customers · attachments · integrations
dictionaries · feature_toggles · ai_assistant · kawalec (overlay, @app)
```

`sales` is **not** enabled in Phase 1; it joins in Phase 5.

## Pipeline definition (D1 + hybrid decision)

Single default pipeline `Default Pipeline` (`is_default=true`) with 9 hybrid stages:

| Position | Name | Color | Icon | Purpose |
|---------:|------|-------|------|---------|
| 0 | Loose | `#a3a3a3` | `lucide:bookmark` | Unassigned / low-context inbox |
| 1 | Lead | `#3b82f6` | `lucide:sparkles` | New contact, not qualified |
| 2 | Qualified | `#8b5cf6` | `lucide:badge-check` | Pain + budget confirmed |
| 3 | Discovery | `#06b6d4` | `lucide:search` | Gathering requirements |
| 4 | Proposal | `#f97316` | `lucide:file-text` | Offer sent |
| 5 | Negotiation | `#facc15` | `lucide:handshake` | Terms negotiation |
| 6 | Won | `#16a34a` | `lucide:trophy` | Closed won |
| 7 | Lost | `#ef4444` | `lucide:x-circle` | Closed lost |
| 8 | Stalled | `#6b7280` | `lucide:pause` | Paused / waiting on customer |

## Dictionaries (D-default + Phase 1)

Use OM defaults shipped by `customers/cli.ts` (broad coverage), do not narrow in Phase 1:

- `source` (11 entries): Cold outreach / Email / LinkedIn / Facebook / Referral / Partner referral / Customer referral / Event / Typeform / Web form / Other
- `industry` (13 entries): SaaS / Software / E-commerce / Healthcare / Financial Services / Manufacturing / Logistics / Energy / Retail / Hospitality / Media / Interior Design / Renewable Energy
- `temperature`, `lifecycle_stage`, `deal_status`, `activity_type`, `address_type`, `job_title`, `renewal_quarter` — OM defaults untouched.

Phase 1 does **not** add `tech_stack` or `deal_type` dictionaries. The PRD wants them as custom fields; we defer them to a follow-up overlay iteration along with company custom fields (ARR, ICP).

## Overlay module: `src/modules/kawalec/`

Pattern: minimal module providing project-specific RBAC features + an idempotent setup CLI invoked after `yarn initialize` on every deploy.

| File | Purpose |
|------|---------|
| `index.ts` | Module metadata (`requires: ['customers', 'auth']`). |
| `acl.ts` | Single feature `kawalec.setup`. |
| `setup.ts` | `defaultRoleFeatures.admin = ['kawalec.*', 'customers.*']`, `defaultRoleFeatures.employee` = customers CRUD subset. |
| `cli.ts` | One command: `mercato kawalec setup-crm`. |

### `setup-crm` algorithm

1. Resolve `tenant_id` + `organization_id` (from CLI flags `--tenant` / `--org` or fallback by deal count, then any tenant/org pair).
2. Upsert the default `CustomerPipeline` named `Default Pipeline`.
3. Replace stages in the pipeline (NULL out `pipeline_stage_id` on deals → delete stages → insert 9 → relink deals).
4. Relink deals: first by `LOWER(name) = LOWER(d.pipeline_stage)`, then via a legacy alias map for OM scaffold values (`opportunity → Qualified`, `marketing_qualified_lead → Lead`, `sales_qualified_lead → Qualified`, `offering → Proposal`, `negotiations → Negotiation`, `win → Won`).
5. Replace `pipeline_stage` dictionary entries with the 9 above (colors + icons).
6. Rename tenant + organization to `Kawalec Agency` only if still on the OM scaffold defaults.

The CLI uses raw SQL through `em.getConnection().execute(...)`. Reasoning: `CustomerPipeline` / `CustomerPipelineStage` are not in `@open-mercato/core`'s public exports (`package.json#exports` only ships `./modules/customers` + `./modules/customers/commands`), so importing entity classes would couple us to internal paths.

Re-run after any edit to stage list: `yarn generate` (re-registers the CLI in `modules.cli.generated.ts`), then `yarn mercato kawalec setup-crm`.

## Production stack

| File | Purpose |
|------|---------|
| `docker-compose.prod.yml` | Caddy (`:80`/`:443`) → `app:3000`. Postgres / Redis / Meilisearch on private network only. `INIT_COMMAND="yarn initialize && yarn mercato kawalec setup-crm"`. |
| `Caddyfile` | Auto-TLS via Let's Encrypt for `cc.kawalec.pl`. Security headers. |
| `.env.production.example` | All secrets templated with generation hints. |
| `docs/deployment.md` | First-deploy + upgrade + backups + day-2 ops. |

`TENANT_DATA_ENCRYPTION_KEY` is mandatory in prod (OM encrypts user data at rest; lose this key → unrecoverable data).

## Phase 1 acceptance criteria

| # | Criterion | Status |
|---|-----------|--------|
| 1 | OM on `kawalec-vps`, reachable at `https://cc.kawalec.pl` | ⏳ pending VPS deploy |
| 2 | Admin login works | ⏳ pending |
| 3 | Account-manager login + CRM read access | ⏳ pending (replace dev users with real emails) |
| 4 | 9 pipeline stages configured | ✅ via `kawalec setup-crm` |
| 5 | Dictionaries configured (source / industry / pipeline_stage / etc.) | ✅ via OM defaults + overlay |
| 6 | Custom fields work (ARR, ICP, tech_stack, deal_type) | ⏳ deferred to follow-up overlay |
| 7 | Twenty data imported (companies, people, opportunities, tasks, notes); 20-row spot check | ⏳ importer CLI to write |
| 8 | MCP server responds to external request with auth | ⏳ enable + token |
| 9 | `docs/mcp-setup.md` for Claude Desktop / Code / Cursor | ⏳ to write |
| 10 | Backup of DB + storage configured + tested | ⏳ cron + rclone on VPS |
| 11 | 12 manual smoke tests from PRD §4.8.1 | ⏳ after deploy |

## Open follow-ups (for Phase 1.x)

- **Custom fields** — add `arr` (CURRENCY) + `icp` (BOOLEAN) on `customers.Company`, `deal_type` (SELECT) on `CustomerDeal`. Likely via `customFieldDefaults.ts` extension in the kawalec overlay (pattern from `customers/customFieldDefaults.js`).
- **`tech_stack` / `deal_type` as dictionaries** — both are not in OM's hardcoded `DICTIONARY_KINDS` set in `customers/commands/shared.ts`, so they need either a forked entry path or representation as custom-field options instead of dictionaries.
- **Real user accounts** — replace `superadmin@acme.com` / `admin@acme.com` / `employee@acme.com` (passwords `secret`) with team emails before prod traffic.
- **AI provider** — confirm exact Gemini 3 model id in `@google/generative-ai` SDK; fall back to `gemini-2.5-flash` if 3-flash not yet exposed.

## Out of scope (Phase 2+)

`support_tickets`, `projects`, `timetracking`, `billing` (with `sales` module), command-center dashboard widgets. See PRD §3.

## Change log

- 2026-05-16: Phase 1 SPEC opened. Architecture corrections vs PRD documented after `node_modules` inspection. Hybrid 9-stage pipeline implemented via `kawalec setup-crm`. Production stack files added (`docker-compose.prod.yml`, `Caddyfile`, `.env.production.example`, `docs/deployment.md`). End-to-end reset verified locally: `db:greenfield → initialize → kawalec setup-crm` produces the expected state.
