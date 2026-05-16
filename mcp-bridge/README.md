# Kawalec Command Center — MCP bridge

stdio MCP server that exposes the Open Mercato CRM at `https://cc.kawalec.pl` to Claude Desktop / Claude Code / Cursor.

See full setup, client configs, examples, and troubleshooting in [`../docs/mcp-setup.md`](../docs/mcp-setup.md).

## Quickstart

```bash
npm install
npm run build
OM_URL=https://cc.kawalec.pl OM_EMAIL=info@craftweb.pl OM_PASSWORD='...' \
  node dist/index.js
```

## Tools

| Tool | Purpose |
|------|---------|
| `list_companies` | Browse B2B accounts. |
| `list_people` | Browse contacts. |
| `list_deals` | Browse deals; filter by `stage` or `query`. |
| `get_deal` | Full deal detail by id. |
| `pipeline_summary` | Counts + value per stage. |
