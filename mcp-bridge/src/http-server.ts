import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { OmClient, registerHandlers } from './tools.js'

const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN
if (!MCP_AUTH_TOKEN) {
  console.error('FATAL: MCP_AUTH_TOKEN env var is required in HTTP mode.')
  process.exit(1)
}

const ALLOWED_HOSTS = (process.env.MCP_ALLOWED_HOSTS ?? '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
    })
    req.on('end', () => {
      if (!data) return resolve(undefined)
      try {
        resolve(JSON.parse(data))
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

function checkAuth(req: IncomingMessage): boolean {
  const auth = req.headers['authorization']
  if (typeof auth !== 'string') return false
  if (!auth.startsWith('Bearer ')) return false
  const token = auth.slice('Bearer '.length).trim()
  return token === MCP_AUTH_TOKEN
}

function unauthorized(res: ServerResponse) {
  res.statusCode = 401
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify({ error: 'Unauthorized' }))
}

function buildSession(om: OmClient): {
  server: Server
  transport: StreamableHTTPServerTransport
} {
  const server = new Server(
    { name: 'kawalec-command-center', version: '0.1.0' },
    { capabilities: { tools: {} } },
  )
  registerHandlers(server, om)
  // Stateless: every request stands on its own (no session id, no event store).
  // Allowed hosts list defends against DNS rebinding when set.
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    allowedHosts: ALLOWED_HOSTS.length > 0 ? ALLOWED_HOSTS : undefined,
  })
  // Connect synchronously is fine — start() is a no-op for streamable HTTP.
  void server.connect(transport)
  return { server, transport }
}

export async function startHttpServer({
  port,
  om,
}: {
  port: number
  om: OmClient
}): Promise<void> {
  const httpServer = createServer(async (req, res) => {
    const url = req.url || '/'
    const path = url.split('?')[0]

    // Health endpoint for Docker/Caddy.
    if (path === '/health' && req.method === 'GET') {
      res.statusCode = 200
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ ok: true }))
      return
    }

    if (path !== '/mcp') {
      res.statusCode = 404
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: 'Not found' }))
      return
    }

    if (!checkAuth(req)) {
      unauthorized(res)
      return
    }

    let parsedBody: unknown
    if (req.method === 'POST') {
      try {
        parsedBody = await readBody(req)
      } catch (err) {
        res.statusCode = 400
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ error: 'Invalid JSON body' }))
        return
      }
    }

    // Build a fresh stateless session per request (matches sessionIdGenerator:undefined).
    const { transport } = buildSession(om)
    try {
      await transport.handleRequest(req, res, parsedBody)
    } catch (err) {
      console.error('handleRequest error:', err)
      if (!res.headersSent) {
        res.statusCode = 500
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ error: 'Internal error' }))
      }
    }
  })

  await new Promise<void>((resolve) => httpServer.listen(port, '0.0.0.0', resolve))
  console.error(
    `kawalec-mcp HTTP bridge listening on :${port} (auth: Bearer <token>, ` +
      `allowed hosts: ${ALLOWED_HOSTS.length ? ALLOWED_HOSTS.join(',') : '*'})`,
  )
}
