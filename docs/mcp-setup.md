# MCP bridge — Claude Desktop / Claude Code / Cursor

Open Mercato ships an in-app AI assistant (Cmd+L) but no native stdio MCP endpoint, so external MCP clients (Claude Desktop, Claude Code, Cursor) cannot subscribe directly. This repo includes `mcp-bridge/` — a small stdio MCP server you run **on your laptop** that translates MCP tool calls into HTTPS requests against `https://cc.kawalec.pl`.

## What's exposed

| Tool | What it does |
|------|--------------|
| `list_companies` | Companies in the CRM. Optional `query` for name filter. |
| `list_people` | Contacts. Optional `query` for name/email filter. |
| `list_deals` | Deals; optional `stage` filter (lead/qualified/proposal/won/...). |
| `get_deal` | Full detail for a single deal by id. |
| `pipeline_summary` | Counts + total value per pipeline stage. |

Read-only at the moment. Mutation tools (create deals, move stages, etc.) come in Phase 1.x — when they land they will route through Open Mercato's *mutation approval* workflow, so the agent proposes a write and you confirm in `/backend/ai-assistant/actions` before it hits the DB.

## Setup (once per laptop)

```bash
# Clone if you haven't already.
git clone https://github.com/dawidkawalec/om-kawalec.git
cd om-kawalec/mcp-bridge

# Node 20+ (24 recommended). With fnm:
fnm use 24 || fnm install 24
npm install
npm run build

# Sanity check (Ctrl+C to stop):
OM_URL=https://cc.kawalec.pl \
OM_EMAIL=info@craftweb.pl \
OM_PASSWORD='<your-password>' \
node dist/index.js
# Expect: "kawalec-mcp bridge ready (target: ..., account: ...)"
```

Tip: store the absolute path to `dist/index.js` somewhere handy — every client config needs it.

## Client configuration

Replace `/absolute/path/to/om-kawalec/mcp-bridge/dist/index.js` with the real path, and fill in your real OM password.

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) — append a `mcpServers` entry:

```json
{
  "mcpServers": {
    "kawalec-cc": {
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

Restart Claude Desktop. The 🔌 plug icon should now show `kawalec-cc` with 5 tools.

### Claude Code

Per-project — create `.mcp.json` in the project root:

```json
{
  "mcpServers": {
    "kawalec-cc": {
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

Or globally — add the same block under `mcpServers` in `~/.claude.json`.

Reload Claude Code (`Cmd+Shift+P` → "Reload window"). Run `/mcp` to confirm `kawalec-cc` is connected.

### Cursor

Edit `~/.cursor/mcp.json` (or use Settings → MCP):

```json
{
  "mcpServers": {
    "kawalec-cc": {
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

Restart Cursor.

## Example prompts to try

After connecting, ask the AI client things like:

- *"Show me the sales pipeline summary."* → invokes `pipeline_summary`.
- *"List the deals that are in the Proposal stage."* → `list_deals` with `stage: proposal`.
- *"How many won deals do we have, and what's the total value?"* → `list_deals` + arithmetic.
- *"Find all companies with 'Engel' in the name."* → `list_companies` with `query: "Engel"`.
- *"Get the details of deal 1670e9d1-ed4a-453c-9201-e20806f30495."* → `get_deal`.

## Security notes

- Bridge authenticates as a real Open Mercato user (`OM_EMAIL`) — currently superadmin. Anything you can do in `/backend` you can do here.
- Token is cached in memory only (no disk persistence); on restart the bridge re-logs in.
- For shared / less-trusted hosts: create a dedicated bot account with the minimum role (`account_manager`) in `/backend/users` and use those credentials in the bridge env.
- TLS: bridge talks HTTPS to Caddy at `cc.kawalec.pl`. No local network exposure.
- The MCP runtime in your client (Claude Desktop / Code / Cursor) spawns the bridge as a child process; nothing is exposed over the network.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `kawalec-cc` missing in client | Path typo or `dist/index.js` not built | `cd mcp-bridge && npm install && npm run build` and use absolute path |
| Bridge logs `FATAL: OM_EMAIL and OM_PASSWORD env vars are required` | env block missing in client config | Add `env` map to the mcpServers entry |
| All tool calls error `OM auth failed (400)` | Wrong password or password rotated | Verify with `curl -X POST https://cc.kawalec.pl/api/auth/login --data-urlencode email=... --data-urlencode password=...` |
| Tool calls hang | Bridge can't reach `cc.kawalec.pl` | Check DNS / VPN; the bridge needs outbound HTTPS |
| Bridge crashes loop | `OM_INIT_SUPERADMIN_PASSWORD` rotated on VPS | Update the password in the client config env |

## Updating the bridge

```bash
cd /absolute/path/to/om-kawalec
git pull origin main
cd mcp-bridge
npm install
npm run build
# Then restart Claude Desktop / Code / Cursor.
```

## Roadmap (Phase 1.x)

- Write tools: `create_lead`, `update_deal_stage`, `add_company`, `add_person` — all gated by Open Mercato's mutation approval (`/backend/ai-assistant/actions`).
- Note tools once the notes/activities surface lands.
- API-key auth (`@open-mercato/core/modules/api_keys`) once that module is enabled in `src/modules.ts` — avoids storing a superadmin password.
- npm-publish so configs can use `"command": "npx", "args": ["-y", "@kawalec/mcp-bridge"]`.
