// routes/cart/route.ts
import { FastifyInstance } from 'fastify'
import { setReservationFromCart } from '../../../services/inventory.js'

type CartBody = {
  organizationId: string
  productIdOrKey: string
  cartId: string
  quantity: number
  previousQuantity?: number
}

export default async function cartRoutes(app: FastifyInstance) {
  app.post(
    '',
    {
      schema: {
        tags: ['cart'],
        summary: 'Set reserved stock for a cart change (previous → next); per-cart tracked for expiry',
        body: {
          type: 'object',
          required: ['organizationId', 'productIdOrKey', 'cartId', 'quantity'],
          properties: {
            organizationId: { type: 'string' },
            productIdOrKey: { type: 'string' },
            cartId: { type: 'string' },
            quantity: { type: 'integer', minimum: 0 },
            previousQuantity: { type: 'integer', minimum: 0, default: 0 }
          }
        }
      }
    },
    async (req, res) => {
      const { organizationId, productIdOrKey, cartId, quantity, previousQuantity = 0 } = req.body as CartBody

      const result = await setReservationFromCart({
        organizationId,
        productIdOrKey,
        cartId,
        previous: previousQuantity,
        next: quantity
      })

      if (!result.ok) {
        const status = result.reason === 'not_found' ? 404 : 409
        return res.code(status).send({ message: result.reason })
      }
      return result
    }
  )
}
