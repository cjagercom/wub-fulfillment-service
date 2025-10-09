// src/services/inventory.ts
import { sql } from '../db/connect.js'
import { clearOrgInventory, getOrgInventory, setOrgInventory } from '../lib/cache.js'

export type InventoryRow = {
  product_id: string
  organization_id: string
  sku: string | null
  ean: string | null
  title: string
  amount: number
}

/** Alle inventory voor een org uit DB ophalen */
async function fetchOrgInventoryFromDB(organizationId: string): Promise<InventoryRow[]> {
  const rows = (await sql`
    SELECT
      p.id AS product_id,
      p.organization_id,
      COALESCE(i.sku, p.sku) AS sku,
      COALESCE(i.ean, p.ean) AS ean,
      p.title,
      GREATEST(COALESCE(i.amount, 0) - COALESCE(i.reserved, 0), 0) AS amount
    FROM products p
    LEFT JOIN inventory i ON i.product_id = p.id
    WHERE p.organization_id = ${organizationId}
    ORDER BY p.title;
  `) as InventoryRow[]
  return rows
}

/** Cache-first ophalen (in-memory singleton) */
export async function getInventoryForOrg(organizationId: string): Promise<InventoryRow[]> {
  const cached = getOrgInventory(organizationId)
  if (cached) return cached
  const fresh = await fetchOrgInventoryFromDB(organizationId)
  setOrgInventory(organizationId, fresh)
  return fresh
}

/** Eén product (uuid/sku/ean) binnen org; eerst cache, anders DB en cache verversen */
export async function getSingleProductFromCacheOrDB(organizationId: string, productId: string) {
  const list = await getInventoryForOrg(organizationId)
  const pid = productId.trim().toLowerCase()
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(pid)

  const fromCache = list.find(
    p => (isUUID && p.product_id.toLowerCase() === pid) || (p.sku && p.sku.toLowerCase() === pid) || (p.ean && p.ean.toLowerCase() === pid)
  )
  if (fromCache) return fromCache

  const row =
    (
      (await sql`
    SELECT
      p.id AS product_id,
      p.organization_id,
      COALESCE(i.sku, p.sku) AS sku,
      COALESCE(i.ean, p.ean) AS ean,
      p.title,
      GREATEST(COALESCE(i.amount, 0) - COALESCE(i.reserved, 0), 0) AS amount
    FROM products p
    LEFT JOIN inventory i ON i.product_id = p.id
    WHERE p.organization_id = ${organizationId}
      AND (
        p.id::text = ${productId}
        OR p.slug = ${productId}
        OR p.ean = ${productId}
        OR i.sku = ${productId}
        OR i.ean = ${productId}
      )
    LIMIT 1;
  `) as InventoryRow[]
    )[0] ?? null

  if (row) {
    const fresh = await fetchOrgInventoryFromDB(organizationId)
    setOrgInventory(organizationId, fresh)
  }
  return row
}

// services/inventory.ts
type SetReservationResult =
  | { ok: true; amount: number; reserved: number; available_after: number }
  | { ok: false; reason: 'insufficient_stock' | 'not_found' }

export async function setReservationFromCart(opts: {
  organizationId: string
  productIdOrKey: string
  cartId: string
  previous: number
  next: number
}): Promise<SetReservationResult> {
  const { organizationId, productIdOrKey, cartId, previous, next } = opts
  if (previous < 0 || next < 0) throw new Error('previous/next must be >= 0')

  const delta = next - previous

  await sql`BEGIN`
  try {
    const prod = (
      await sql`
      SELECT p.id AS product_id
      FROM products p
      LEFT JOIN inventory i ON i.product_id = p.id
      WHERE p.organization_id = ${organizationId}
        AND (p.id::text = ${productIdOrKey}
             OR p.slug = ${productIdOrKey}
             OR p.ean = ${productIdOrKey}
             OR i.sku = ${productIdOrKey}
             OR i.ean = ${productIdOrKey})
      LIMIT 1;
    `
    )[0]
    if (!prod) {
      await sql`ROLLBACK`
      return { ok: false, reason: 'not_found' }
    }

    if (delta !== 0) {
      // Guards op voorraad: delta>0 -> genoeg vrij; delta<0 -> genoeg gereserveerd in totaliteit
      const ok =
        (
          await sql`
        UPDATE inventory
           SET updated_at = NOW()
         WHERE product_id = ${prod.product_id}
           AND organization_id = ${organizationId}
           AND (
                (${delta} > 0 AND (amount - reserved) >= ${delta})
             OR (${delta} < 0 AND reserved >= ${-delta})
           )
        RETURNING 1;
      `
        ).length > 0
      if (!ok) {
        await sql`ROLLBACK`
        return { ok: false, reason: 'insufficient_stock' }
      }

      // UPSERT per cart
      await sql`
        INSERT INTO inventory_reservations (organization_id, product_id, cart_id, qty)
        VALUES (${organizationId}, ${prod.product_id}, ${cartId}, ${next})
        ON CONFLICT (organization_id, product_id, cart_id)
        DO UPDATE SET qty = EXCLUDED.qty, updated_at = NOW();
      `
      // trigger werkt nu de inventory.reserved bij met delta
    }

    const cur = (
      await sql`
      SELECT amount, reserved, (amount - reserved) AS available_after
      FROM inventory
      WHERE product_id = ${prod.product_id} AND organization_id = ${organizationId}
      LIMIT 1;
    `
    )[0]

    await sql`COMMIT`

    if (!cur) return { ok: false, reason: 'not_found' }
    clearOrgInventory(organizationId)
    return { ok: true, amount: cur.amount, reserved: cur.reserved, available_after: cur.available_after }
  } catch (e) {
    await sql`ROLLBACK`.catch(() => {})
    throw e
  }
}

export async function fulfillOrder(opts: { organizationId: string; items: Array<{ productIdOrKey: string; quantity: number }>; orderId: string }) {
  const { organizationId, items, orderId } = opts

  // 1) Merge by productIdOrKey (voorkomt dubbele aftrek bij herhaalde entries in payload)
  const merged = new Map<string, number>()
  for (const it of items) {
    if (it.quantity <= 0) continue
    merged.set(it.productIdOrKey, (merged.get(it.productIdOrKey) ?? 0) + it.quantity)
  }

  const low: Array<{ title: string; amount: number; threshold: number }> = []

  await sql`BEGIN`
  try {
    for (const [productIdOrKey, qty] of merged) {
      const found = (
        await sql`
          SELECT p.id AS product_id, p.title
          FROM products p
          LEFT JOIN inventory i ON i.product_id = p.id
          WHERE p.organization_id = ${organizationId}
            AND (
              p.id::text = ${productIdOrKey}
              OR p.slug = ${productIdOrKey}
              OR p.ean = ${productIdOrKey}
              OR i.sku = ${productIdOrKey}
              OR i.ean = ${productIdOrKey}
            )
          LIMIT 1;
        `
      )[0]
      if (!found) {
        console.warn('[FULFILL][skip] product not found', { key: productIdOrKey })
        continue
      }

      // 2) Idempotency: probeer deze order+product-combinatie te registreren
      const firstTime =
        (
          await sql`
          INSERT INTO fulfillment_ledger (order_id, product_id, quantity)
          VALUES (${orderId}, ${found.product_id}, ${qty})
          ON CONFLICT (order_id, product_id) DO NOTHING
          RETURNING 1;
        `
        ).length > 0

      if (!firstTime) {
        // Deze order+product is al verwerkt; sla netjes over.
        console.info('[FULFILL] duplicate call skipped (idempotent)', {
          orderId,
          productId: found.product_id
        })
        continue
      }

      // 3) Verlaag amount (guard tegen negatieve voorraad)
      const after = (
        await sql`
          UPDATE inventory
          SET amount = amount - ${qty},
              updated_at = NOW()
          WHERE product_id = ${found.product_id}
            AND organization_id = ${organizationId}
            AND amount >= ${qty}
          RETURNING amount, threshold, ${found.title} AS title;
        `
      )[0]

      if (!after) {
        // terugdraaien ledger-entry zodat een nieuwe poging later nog kan
        await sql`
          DELETE FROM fulfillment_ledger
          WHERE order_id = ${orderId} AND product_id = ${found.product_id};
        `
        throw new Error('amount_too_low')
      }

      if (after.amount <= after.threshold) {
        low.push({ title: after.title, amount: after.amount, threshold: after.threshold })
      }
    }

    await sql`COMMIT`
  } catch (e) {
    await sql`ROLLBACK`.catch(() => {})
    throw e
  }

  // Cache verversen (zoals je al deed)
  const fresh = await fetchOrgInventoryFromDB(organizationId)
  setOrgInventory(organizationId, fresh)

  if (low.length) {
    console.info('[MAIL][threshold_reached]', {
      to: 'ops@example.com',
      organizationId,
      items: low
    })
  }

  return { ok: true as const, lowCount: low.length }
}
