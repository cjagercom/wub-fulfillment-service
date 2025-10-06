import { FastifyInstance } from 'fastify'
import { helloSchema } from './schema.js'

export default async function helloRoutes(app: FastifyInstance) {
  app.get('', { schema: helloSchema }, async () => ({
    message: 'world'
  }))
}
