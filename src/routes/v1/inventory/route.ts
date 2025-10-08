import { FastifyInstance } from 'fastify'
import { getInventoryForOrg } from '../../../services/inventory.js'

export default async function inventoryRoutes(app: FastifyInstance) {
  app.get(
    '',
    {
      schema: {
        tags: ['inventory'],
        querystring: {
          type: 'object',
          required: ['organizationId'],
          properties: { organizationId: { type: 'string' } }
        }
      }
    },
    async req => {
      const { organizationId } = req.query as { organizationId: string }
      return getInventoryForOrg(organizationId)
    }
  )
}
