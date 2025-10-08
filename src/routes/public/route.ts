import { FastifyInstance } from 'fastify'
export default async function r(app: FastifyInstance) {
  app.get('/', async () => ({ name: 'WUB Fulfillment API', docs: '/', api: '/api/v1' }))
}
