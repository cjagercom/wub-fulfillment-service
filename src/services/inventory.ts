// src/services/inventory.ts
import { sql } from '../db/connect.js'
import { getOrgInventory, setOrgInventory } from '../lib/cache.js'

export type InventoryRow = {
  product_id: string
  organization_id: string
  sku: string | null
  ean: string | null
  title: string
  amount: number
  reserved: number
  threshold: number
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
      GREATEST(COALESCE(i.amount, 0) - COALESCE(i.reserved, 0), 0) AS amount,
      COALESCE(i.reserved, 0) AS reserved,
      COALESCE(i.threshold, 0) AS threshold
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
      GREATEST(COALESCE(i.amount, 0) - COALESCE(i.reserved, 0), 0) AS amount,
      COALESCE(i.reserved, 0) AS reserved,
      COALESCE(i.threshold, 0) AS threshold
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

type SetReservationResult =
  | { ok: true; amount: number; reserved: number; available_after: number }
  | { ok: false; reason: 'insufficient_stock' | 'stale_previous_quantity' | 'not_found' }

export async function setReservationFromCart(opts: {
  organizationId: string
  productIdOrKey: string
  previous: number // oude cart-waarde (>= 0)
  next: number // nieuwe cart-waarde (>= 0)
}): Promise<SetReservationResult> {
  const { organizationId, productIdOrKey, previous, next } = opts

  if (previous < 0 || next < 0) throw new Error('previous/next must be >= 0')

  await sql`BEGIN`
  try {
    // Vind product_id binnen organisatie op basis van id/slug/ean/sku
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

    // Atomisch: reserved = reserved - previous + next
    // Voorwaarden:
    // - reserved >= previous  (optimistische lock tegen verouderde cart)
    // - (amount - reserved + previous) >= next  (voldoende vrije voorraad)
    const updated = (
      await sql`
        UPDATE inventory
        SET reserved = reserved - ${previous} + ${next},
            updated_at = NOW()
        WHERE product_id = ${prod.product_id}
          AND organization_id = ${organizationId}
          AND reserved >= ${previous}
          AND (amount - reserved + ${previous}) >= ${next}
        RETURNING amount, reserved, (amount - reserved) AS available_after;
      `
    )[0]

    if (!updated) {
      // Bepaal of het een stale-previous of voorraad-issue is
      const current = (
        await sql`
          SELECT amount, reserved FROM inventory
          WHERE product_id = ${prod.product_id} AND organization_id = ${organizationId}
          LIMIT 1;
        `
      )[0]

      await sql`ROLLBACK`

      if (!current) return { ok: false, reason: 'not_found' }
      if (current.reserved < previous) return { ok: false, reason: 'stale_previous_quantity' }
      // Anders is het gebrek aan vrije voorraad
      return { ok: false, reason: 'insufficient_stock' }
    }

    await sql`COMMIT`

    // (optioneel) Mock Monta-calls zoals je dat al deed
    console.info('[MONTA][reserve:set]', {
      organizationId,
      productId: prod.product_id,
      from: previous,
      to: next
    })

    // Cache verversen
    const fresh = await fetchOrgInventoryFromDB(organizationId)
    setOrgInventory(organizationId, fresh)

    return {
      ok: true,
      amount: updated.amount,
      reserved: updated.reserved,
      available_after: updated.available_after
    }
  } catch (err) {
    await sql`ROLLBACK`.catch(() => {
      console.warn('[TX] rollback failed (likely no open transaction)')
    })
    throw err
  }
}

// --- fulfill (na betaling): mock ship + mock stock refresh; update DB + cache; bundel “threshold” mail
export async function fulfillOrder(opts: { organizationId: string; items: Array<{ productIdOrKey: string; quantity: number }>; orderId: string }) {
  const { organizationId, items, orderId } = opts

  console.info('[MONTA][ship_order]', { organizationId, orderId, items })

  const low: Array<{ title: string; amount: number; threshold: number }> = []

  await sql`BEGIN`
  try {
    for (const it of items) {
      const found = (
        await sql`
      SELECT
        p.id AS product_id,
        p.title
      FROM products p
      LEFT JOIN inventory i ON i.product_id = p.id
      WHERE p.organization_id = ${organizationId}
        AND (p.id::text = ${it.productIdOrKey}
             OR p.slug = ${it.productIdOrKey}
             OR p.ean = ${it.productIdOrKey}
             OR i.sku = ${it.productIdOrKey}
             OR i.ean = ${it.productIdOrKey})
      LIMIT 1;
    `
      )[0]
      if (!found) continue

      // reservering definitief maken: amount én reserved omlaag met dezelfde qty
      const after = (
        await sql`
      UPDATE inventory
      SET
        amount     = amount    - ${it.quantity},
        reserved   = reserved  - ${it.quantity},
        updated_at = NOW()
      WHERE product_id = ${found.product_id}
        AND organization_id = ${organizationId}
        AND reserved >= ${it.quantity}
      RETURNING amount, threshold, ${found.title} AS title;
    `
      )[0]

      // als reserved te laag was, is er niets geüpdatet; sla over of log
      if (!after) {
        console.warn('[FULFILL][skip] reserved too low', { productId: found.product_id, quantity: it.quantity })
        continue
      }

      // optioneel: alleen logging naar “MONTA”
      console.info('[MONTA][get_stock_after_ship]', { productId: found.product_id })

      // drempel-check op de NIEUWE waarden
      if (after.amount <= after.threshold) {
        low.push({ title: after.title, amount: after.amount, threshold: after.threshold })
      }
    }

    await sql`COMMIT`
  } catch (err) {
    // probeer rollback, maar gooi de originele fout opnieuw
    await sql`ROLLBACK`.catch(() => {
      console.warn('[TX] rollback failed (likely no open transaction)')
    })
    throw err
  }

  // Cache refresh
  const fresh = await fetchOrgInventoryFromDB(organizationId)
  setOrgInventory(organizationId, fresh)

  // Bundel “mail” (mock) als iets onder drempel zit
  if (low.length) {
    console.info('[MAIL][threshold_reached]', {
      to: 'ops@example.com',
      organizationId,
      items: low
    })
  }

  return { ok: true as const, refreshed: true, lowCount: low.length }
}
