import { FastifyInstance } from 'fastify'
import { fulfillOrder } from '../../../../services/inventory.js'

export default async function orderRoutes(app: FastifyInstance) {
  app.post(
    '',
    {
      schema: {
        tags: ['order'],
        summary: 'Fulfill an order (mock ship + refresh stock)',
        body: {
          type: 'object',
          required: ['organizationId', 'orderId', 'items'],
          properties: {
            organizationId: { type: 'string' },
            orderId: { type: 'string' },
            items: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                required: ['productIdOrKey', 'quantity'],
                properties: {
                  productIdOrKey: { type: 'string' },
                  quantity: { type: 'integer', minimum: 1 }
                }
              }
            }
          }
        }
      }
    },
    async req => {
      const { organizationId, orderId, items } = req.body as any
      return fulfillOrder({ organizationId, orderId, items })
    }
  )
}
