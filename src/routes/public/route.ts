import { FastifyInstance } from 'fastify'

export default async function (app: FastifyInstance) {
  app.get('/', { schema: { hide: true } }, (_req, reply) => reply.redirect('/docs', 302))
}
