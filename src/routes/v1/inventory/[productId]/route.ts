import { FastifyInstance } from 'fastify'
import { getSingleProductFromCacheOrDB } from '../../../../services/inventory.js'

export const autoPrefix = '/inventory/:productId'

export default async function inventoryItemRoute(app: FastifyInstance) {
  app.get(
    '',
    {
      schema: {
        tags: ['inventory'],
        summary: 'Get single product inventory (uuid/sku/ean)',
        params: {
          type: 'object',
          required: ['productId'],
          properties: { productId: { type: 'string' } }
        },
        querystring: {
          type: 'object',
          required: ['organizationId'],
          properties: { organizationId: { type: 'string' } }
        }
      }
    },
    async (req, res) => {
      const { organizationId } = req.query as { organizationId: string }
      const { productId } = req.params as { productId: string }
      const row = await getSingleProductFromCacheOrDB(organizationId, productId)
      if (!row) return res.code(404).send({ message: 'not found' })
      return row
    }
  )
}
