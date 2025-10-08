import { FastifyInstance } from 'fastify'

export default async function (app: FastifyInstance) {
  app.get('/', (_req, reply) => reply.code(302).redirect('/docs'))
}
