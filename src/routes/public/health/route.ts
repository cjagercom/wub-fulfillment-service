import { FastifyInstance } from 'fastify'

export default async function healthRoutes(app: FastifyInstance) {
  app.get(
    '',
    {
      schema: {
        tags: ['public'],
        hide: true,
        response: {
          200: {
            type: 'object',
            properties: {
              ok: { type: 'boolean' },
              ts: { type: 'number' }
            },
            required: ['ok', 'ts']
          }
        }
      }
    },
    async () => ({
      ok: true,
      ts: Date.now()
    })
  )
}
