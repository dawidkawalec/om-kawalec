# AI Assistant setup — Kawalec Command Center

Open Mercato ships with a built-in AI assistant (OpenCode agent + MCP HTTP server on internal port 3001). This document covers what's available out of the box, how to enable Gemini, and how external clients (Claude Desktop / Claude Code) can connect today.

## What you get out of the box

| Surface | Where | What for |
|---------|-------|----------|
| In-app command palette | Topbar **AI** button or **⌘L** / **Ctrl+L** anywhere in `/backend` | Natural-language CRM queries ("show deals in Negotiation", "create a lead from this note") |
| Dedicated chat page | `/backend/ai-assistant` | Long-form sessions, transcripts |
| Mutation approval inbox | `/backend/ai-assistant/actions` (or similar — link from chat sidebar) | Review and confirm/cancel proposed writes before they hit the DB |
| Per-tenant settings | `/backend/settings/ai-assistant` (allowlists, prompt overrides) | Limit which models a tenant can pick, override system prompts |

**MCP role in OM:** internal-only. OpenCode talks to its own MCP HTTP server on `:3001` to discover and execute tools. There is **no native MCP endpoint** that Claude Desktop or Claude Code can subscribe to via stdio. For external use see [Connecting external MCP clients](#connecting-external-mcp-clients) below.

## Configuration (Phase 1: Google Gemini per PRD D2)

Set in `.env` (local) or `.env` on the VPS:

```bash
OM_AI_PROVIDER=google
OM_AI_MODEL=google/gemini-2.5-flash
GOOGLE_GENERATIVE_AI_API_KEY=<your-google-aistudio-key>
```

Get a key at <https://aistudio.google.com/app/apikey>.

Once Gemini 3 Flash is exposed in `@google/generative-ai`, swap `OM_AI_MODEL` to `google/gemini-3-flash`. The runtime tolerates unknown models with a warning and falls back to the provider's default.

### Anthropic / OpenAI as fallback

The PRD picked Sonnet 4.6 as secondary fallback. Configure both keys; switch in the `/backend/settings/ai-assistant` UI per agent or globally via env:

```bash
ANTHROPIC_API_KEY=<sk-ant-...>
# Optional global default override:
# OM_AI_PROVIDER=anthropic
# OM_AI_MODEL=anthropic/claude-sonnet-4-6
```

### Per-module overrides

OM supports `OM_AI_<MODULE>_PROVIDER` / `OM_AI_<MODULE>_MODEL` (per PRD D2 follow-up). Example:

```bash
# Use Opus 4.7 for customer-facing agents only.
OM_AI_CUSTOMERS_PROVIDER=anthropic
OM_AI_CUSTOMERS_MODEL=anthropic/claude-opus-4-7
```

## Mutation approval (PRD D3)

Default: **ON**. The agent never writes to the DB directly; it creates a `pending_action` row that an admin (`ai_assistant.manage` feature) confirms in the UI. Configure exceptions per tool in `/backend/settings/ai-assistant`.

Lifecycle endpoints:
- `GET  /api/ai-assistant/ai/actions/[id]` — inspect a pending action
- `POST /api/ai-assistant/ai/actions/[id]/confirm` — apply the write
- `POST /api/ai-assistant/ai/actions/[id]/cancel` — drop it

## Health check

```bash
curl -fsSL http://localhost:3000/api/ai-assistant/health -H "Cookie: $YOUR_SESSION_COOKIE"
# {"opencode":"ok","mcp":"ok",...}
```

In CI / monitoring: hit it with an authenticated session cookie. Returns `200` + JSON describing OpenCode + MCP socket status, `5xx` if either is down.

## API surface (for app developers)

Auth: every endpoint requires a session JWT (cookie) + `ai_assistant.view` feature.

| Method + path | Purpose |
|---------------|---------|
| `POST /api/ai-assistant/ai/chat` | Single-turn or streaming chat. Body: `{ messages, agentId?, modelOverride? }`. |
| `POST /api/ai-assistant/ai/run-object` | Run an agent expecting a structured output (zod schema). |
| `GET  /api/ai-assistant/ai/agents` | List available agents (auto-discovered from modules). |
| `POST /api/ai-assistant/tools/execute` | Direct tool invocation (Code Mode). |
| `GET  /api/ai-assistant/session-key` | Short-lived session key for browser-side streaming. |

Full OpenAPI: `http://localhost:3000/api/openapi` (filter by tag "AI Assistant").

## Connecting external MCP clients

The native MCP server only speaks HTTP and is bound to the OpenCode runtime inside the app — it is **not** a stdio MCP server consumable by Claude Desktop directly.

Three options to bridge:

### Option A — OM's built-in Claude Code workflow (no extra setup)

Open `/backend` while running Claude Code in this repo. The AI assistant talks to OM via its own session; Claude Code separately reads source code. This is the cleanest path for *developer* workflows but does not give Claude Code direct access to CRM data.

### Option B — Custom MCP bridge (planned for Phase 1.x)

Small Node or Python process that:
1. Speaks stdio MCP to Claude Desktop / Claude Code.
2. Authenticates against OM with an API key (see `modules/api_keys` — admin → Settings → API keys).
3. Exposes a curated set of OM tools (e.g. `crm.list_deals_by_stage`, `crm.create_lead`) by proxying to `POST /api/ai-assistant/tools/execute`.
4. Honors mutation approval: writes return a pending-action id; bridge surfaces "needs approval in OM UI" to the caller.

Tracked in [`.ai/specs/SPEC-2026-05-15-crm-foundation.md`](../.ai/specs/SPEC-2026-05-15-crm-foundation.md) as a follow-up item.

### Option C — Use OM's `ai_assistant` API directly from your client

If your client supports HTTP tool calls (Cursor's "Tools", Continue's custom providers), point it at `POST /api/ai-assistant/ai/chat` with an OM API key in the `Authorization` header. Mutation approval still applies.

## Day-1 smoke test (PRD §4.8.1 #10–11)

1. Log in as admin in `/backend`.
2. Press **⌘L**. Type: *"How many deals are in stage Qualified?"*. Agent should call the search tool and answer.
3. Type: *"Create a lead 'Test Smoke Lead' from source 'LinkedIn'."*. Agent proposes a write → opens approval dialog → confirm. Verify the deal appears in `/backend/customers/deals`.

If either step fails, check `/api/ai-assistant/health` and the app logs (`docker compose logs -f app` in prod, `yarn dev` output locally).

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| "Provider not configured" warning at boot | `OM_AI_PROVIDER` set but matching API key blank | Fill `GOOGLE_GENERATIVE_AI_API_KEY` (or rotate to a configured provider) |
| Agent replies "I don't have access" to CRM data | Logged-in user lacks `customers.deals.view` feature | Grant via role in `/backend/settings/roles` |
| Approval dialog never appears for a write | Tool registered without `requiredFeatures` or mutation-policy override is set to "auto" | Inspect `/backend/settings/ai-assistant` → mutation policies |
| Streaming chat hangs | OpenCode container down | `docker compose -f docker-compose.prod.yml restart app` |
