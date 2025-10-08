import { FastifyInstance } from 'fastify'
import { reserveProduct } from '../../../services/inventory.js'

export default async function cartRoutes(app: FastifyInstance) {
  app.post(
    '',
    {
      schema: {
        tags: ['cart'],
        summary: 'Reserve product stock',
        body: {
          type: 'object',
          required: ['organizationId', 'productIdOrKey', 'quantity'],
          properties: {
            organizationId: { type: 'string' },
            productIdOrKey: { type: 'string' },
            quantity: { type: 'integer', minimum: 1 }
          }
        }
      }
    },
    async (req, res) => {
      const { organizationId, productIdOrKey, quantity } = req.body as any
      const result = await reserveProduct({ organizationId, productIdOrKey, quantity })
      if (!result.ok) return res.code(409).send({ message: result.reason })
      return result
    }
  )
}
