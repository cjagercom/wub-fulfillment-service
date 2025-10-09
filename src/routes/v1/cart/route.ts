// routes/cart/route.ts
import { FastifyInstance } from 'fastify'
import { setReservationFromCart } from '../../../services/inventory.js'

type CartBody = {
  organizationId: string
  productIdOrKey: string
  quantity: number
  previousQuantity?: number
}

export default async function cartRoutes(app: FastifyInstance) {
  app.post(
    '',
    {
      schema: {
        tags: ['cart'],
        summary: 'Set reserved stock for a cart change (previous → next); use previous 0 in case of new item to cart.',
        body: {
          type: 'object',
          required: ['organizationId', 'productIdOrKey', 'quantity'],
          properties: {
            organizationId: { type: 'string' },
            productIdOrKey: { type: 'string' },
            quantity: { type: 'integer', minimum: 0 },
            previousQuantity: { type: 'integer', minimum: 0, default: 0 }
          }
        }
      }
    },
    async (req, res) => {
      const { organizationId, productIdOrKey, quantity, previousQuantity = 0 } = req.body as CartBody

      const result = await setReservationFromCart({
        organizationId,
        productIdOrKey,
        previous: previousQuantity,
        next: quantity
      })

      if (!result.ok) {
        const status = result.reason === 'not_found' ? 404 : result.reason === 'stale_previous_quantity' ? 409 : 409 // insufficient_stock
        return res.code(status).send({ message: result.reason })
      }

      return result
    }
  )
}
