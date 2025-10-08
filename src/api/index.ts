// api/index.ts
import { buildServer } from '../app.js'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const app = buildServer()

export default async function handler(req: VercelRequest, res: VercelResponse) {
  await app.ready()
  // stuur het raw Node-request door naar Fastify
  app.server.emit('request', req as any, res as any)
}
