import { FastifyInstance } from 'fastify'
import { healthSchema } from './schema.js'

export default async function healthRoutes(app: FastifyInstance) {
  app.get('', { schema: healthSchema }, async () => ({
    ok: true,
    ts: Date.now()
  }))
}
