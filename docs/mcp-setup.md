# MCP bridge — Claude Desktop / Claude Code / Cursor / mobile

Open Mercato ships an in-app AI assistant (⌘L) but no native MCP endpoint. We host a thin MCP bridge that translates Model-Context-Protocol tool calls into authenticated HTTPS calls against `https://cc.kawalec.pl`. Two transports are available:

- **HTTP (recommended)** — `https://mcp.cc.kawalec.pl/mcp` with a Bearer token. Works from any MCP client with HTTP-MCP support (Claude Desktop, Claude Code, Cursor, mobile, web). No local install.
- **stdio** — `mcp-bridge/dist/index.js` spawned by your local MCP client. Useful for offline/dev work.

## What's exposed

| Tool | What it does |
|------|--------------|
| `list_companies` | Companies. Optional `query` (name filter), `limit`. |
| `list_people` | Contacts. Optional `query` (name/email), `limit`. |
| `list_deals` | Deals; optional `stage` (lead/qualified/proposal/won/...), `query`, `limit`. |
| `get_deal` | Full detail for a single deal by id. |
| `pipeline_summary` | Counts + total value per pipeline stage. |

Read-only in Phase 1. Mutation tools (create deal, move stage, …) land in 1.x and will route through Open Mercato's *mutation approval* workflow.

## HTTP — recommended

Bridge runs on the VPS (`cc-mcp` container) behind Caddy. You only need the URL + Bearer token (`MCP_AUTH_TOKEN` from `/root/stacks/command-center/.env`).

### Claude Desktop / Claude Code / Cursor (one-shot CLI)

```bash
claude mcp add --transport http kawalec-cc https://mcp.cc.kawalec.pl/mcp \
  --header "Authorization: Bearer <MCP_AUTH_TOKEN>"
```

Restart the client. `claude mcp list` should report `kawalec-cc … ✓ Connected`.

### Claude Desktop manual config

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "kawalec-cc": {
      "type": "http",
      "url": "https://mcp.cc.kawalec.pl/mcp",
      "headers": {
        "Authorization": "Bearer <MCP_AUTH_TOKEN>"
      }
    }
  }
}
```

### Cursor

`~/.cursor/mcp.json` — same `mcpServers` block as above. Restart Cursor.

### Mobile / web MCP clients

Any client that supports Streamable HTTP MCP and custom headers works. Provide `https://mcp.cc.kawalec.pl/mcp` + `Authorization: Bearer …`.

### Test from a shell

```bash
TOKEN='<MCP_AUTH_TOKEN>'
curl -sS https://mcp.cc.kawalec.pl/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"pipeline_summary","arguments":{}}}'
```

## stdio — for local-only / dev use

```bash
git clone https://github.com/dawidkawalec/om-kawalec.git
cd om-kawalec/mcp-bridge
fnm use 24 || fnm install 24
npm install
npm run build

# Smoke test (Ctrl+C to stop):
OM_URL=https://cc.kawalec.pl \
OM_EMAIL=info@craftweb.pl \
OM_PASSWORD='<your-password>' \
node dist/index.js
```

Then for **Claude Desktop**:

```json
{
  "mcpServers": {
    "kawalec-cc-local": {
      "command": "node",
      "args": ["/absolute/path/to/om-kawalec/mcp-bridge/dist/index.js"],
      "env": {
        "OM_URL": "https://cc.kawalec.pl",
        "OM_EMAIL": "info@craftweb.pl",
        "OM_PASSWORD": "<your-superadmin-password>"
      }
    }
  }
}
```

Same shape for Cursor (`~/.cursor/mcp.json`) and Claude Code (`.mcp.json` in repo root).

## Example prompts

After connecting, try:

- *"Show me the sales pipeline summary."* → `pipeline_summary`
- *"List the deals that are in the Proposal stage."* → `list_deals` with `stage: proposal`
- *"How many won deals do we have, and what's the total value?"* → `list_deals` + arithmetic
- *"Find all companies with 'Engel' in the name."* → `list_companies` with `query: "Engel"`
- *"Get the details of deal 1670e9d1-…"* → `get_deal`

## Security notes

- HTTP transport: Bearer token is the only secret on the wire. Rotate by changing `MCP_AUTH_TOKEN` in `/root/stacks/command-center/.env` and `docker compose -f docker-compose.prod.yml up -d --force-recreate mcp`.
- Bridge logs in to OM as the superadmin (`OM_INIT_SUPERADMIN_EMAIL`). Anything that account can do in `/backend` is reachable via the bridge.
- DNS-rebinding guard: bridge accepts traffic only from `MCP_ALLOWED_HOSTS` (default `mcp.cc.kawalec.pl`).
- For less-trusted clients: create a dedicated `account_manager` user in `/backend/users` and point a second MCP container at those credentials with a separate token.
- TLS terminated at the shared Caddy on `cc.kawalec.pl` (Let's Encrypt). No plaintext anywhere.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `401 Unauthorized` | Wrong / missing Bearer token | Re-read `MCP_AUTH_TOKEN` from `/root/.mcp-bridge-token` on VPS |
| `tools/list` returns empty | Server unreachable | `curl -fsSI https://mcp.cc.kawalec.pl/health` should return 200 |
| `tools/call ... pipeline_summary` errors with `OM auth failed (400)` | OM superadmin password rotated | Update `OM_INIT_SUPERADMIN_PASSWORD` in VPS `.env`, recreate `cc-mcp` |
| Client says "Needs authentication" with no UI | Custom headers not supported in that client | Use stdio transport instead |
| `kawalec-cc` not appearing in `mcp list` | Client didn't reload | Restart the MCP client; `claude mcp list` to verify |

## Updating the bridge

```bash
ssh kawalec-vps
cd /root/stacks/command-center
git pull origin main
docker compose -f docker-compose.prod.yml build mcp
docker compose -f docker-compose.prod.yml up -d mcp
```

For stdio installs: `cd mcp-bridge && git pull && npm install && npm run build`; restart the MCP client.

## Roadmap (Phase 1.x)

- Write tools (`create_lead`, `update_deal_stage`, `add_company`, `add_person`) gated by Open Mercato's mutation approval — agent proposes, you confirm in `/backend/ai-assistant/actions`.
- Note/activity surface tools.
- `api_keys` module enabled, bridge swapped from superadmin login to long-lived API keys (no shared password in env).
- npm-publish for stdio installs (`npx -y @kawalec/mcp-bridge`).
