#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { OmClient, registerHandlers } from './tools.js'

const OM_URL = (process.env.OM_URL || 'https://cc.kawalec.pl').replace(/\/$/, '')
const OM_EMAIL = process.env.OM_EMAIL
const OM_PASSWORD = process.env.OM_PASSWORD

if (!OM_EMAIL || !OM_PASSWORD) {
  console.error('FATAL: OM_EMAIL and OM_PASSWORD env vars are required.')
  process.exit(1)
}

const httpPort = process.env.MCP_HTTP_PORT
const om = new OmClient({ url: OM_URL, email: OM_EMAIL, password: OM_PASSWORD })

async function runStdio() {
  const server = new Server(
    { name: 'kawalec-command-center', version: '0.1.0' },
    { capabilities: { tools: {} } },
  )
  registerHandlers(server, om)
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error(`kawalec-mcp stdio bridge ready (target: ${OM_URL}, account: ${OM_EMAIL})`)
}

async function runHttp(port: number) {
  // Defer the HTTP runtime to a separate module so stdio installs (Claude Desktop)
  // don't have to load Express transitive deps when not needed.
  const mod = await import('./http-server.js')
  await mod.startHttpServer({ port, om })
}

if (httpPort) {
  runHttp(Number(httpPort)).catch((err) => {
    console.error('Fatal (HTTP):', err)
    process.exit(1)
  })
} else {
  runStdio().catch((err) => {
    console.error('Fatal (stdio):', err)
    process.exit(1)
  })
}
